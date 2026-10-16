import type { TargetRow } from './types';

export type CheckStage = 'fetch' | 'identity_validation' | 'extraction' | 'comparison' | 'persistence' | 'notification';
export class CheckError extends Error {
  constructor(readonly code: string, readonly httpStatus: number | null = null, readonly transient = false, readonly stage: CheckStage = 'fetch') { super(code); }
}

export function checkError(error: unknown, stage: CheckStage = 'fetch'): CheckError {
  if (error instanceof CheckError) return error;
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return new CheckError('FETCH_TIMEOUT', null, true, stage);
  if (error instanceof TypeError) return new CheckError('FETCH_CONNECTION_FAILED', null, true, stage);
  const known = /^(?:URL_(?:SCHEME|CREDENTIALS|PORT|PRIVATE_HOST)|MIXI_(?:API_(?:ORIGIN_INVALID|REDIRECT_UNEXPECTED|RESPONSE_TOO_LARGE|INVALID_RESPONSE)|CATEGORY_MAP_(?:UNAVAILABLE|INVALID)|JOB_(?:LINK_INVALID|ID_INVALID|COUNT_LIMIT))|ROBOTS_(?:DISALLOWED|POLICY_UNVERIFIABLE)|INSUFFICIENT_PUBLIC_CONTENT|UNSUPPORTED_CONTENT_TYPE|REDIRECT_WITHOUT_LOCATION|TOO_MANY_REDIRECTS|LOGIN_REQUIRED|ACCESS_RESTRICTED|FETCH_(?:TIMEOUT|CONNECTION_FAILED)|DNS_CHECK_FAILED|RATE_LIMITED|HTTP_\d{3})$/;
  const code = error instanceof Error && known.test(error.message) ? error.message : 'CHECK_FAILED';
  return new CheckError(code, /^HTTP_\d{3}$/.test(code) ? Number(code.slice(5)) : null, /^(FETCH_TIMEOUT|FETCH_CONNECTION_FAILED|DNS_CHECK_FAILED|ROBOTS_POLICY_UNVERIFIABLE|RATE_LIMITED|HTTP_(429|502|503|504))$/.test(code), stage);
}

export type RunBudget = {
  deadline: number; retriesLeft: number; requests: number; retries: number;
  dns: Map<string, Promise<void>>; robots: Map<string, Promise<string | null>>;
};
export function runBudget(durationMs = 90_000, retries = 3): RunBudget {
  return { deadline: Date.now() + durationMs, retriesLeft: retries, requests: 0, retries: 0, dns: new Map(), robots: new Map() };
}
export class SourceTrace {
  readonly started = Date.now();
  readonly deadline: number;
  stage: CheckStage = 'fetch';
  requestMs = 0; extractionMs = 0; requests = 0; retries = 0;
  httpStatus: number | null = null;
  completed = false;
  constructor(readonly target: Pick<TargetRow, 'id' | 'company_id' | 'source_type'>, readonly runId: string, readonly budget = runBudget(), readonly natural = false) {
    this.deadline = Math.min(budget.deadline, this.started + 45_000);
  }
  log(event: string, fields: { errorCode?: string | null; healthStatus?: string; completed?: boolean; decision?: string; requestKind?: string; elapsedMs?: number; attempt?: number; httpStatus?: number | null } = {}) {
    if (fields.completed !== undefined) this.completed = fields.completed;
    // Whitelisted fields only: never serialize exceptions, HTML, headers or URLs.
    console.info({ event, sourceId: this.target.id, companyId: this.target.company_id, sourceType: this.target.source_type, runId: this.runId, stage: this.stage,
      httpStatus: this.httpStatus, requestMs: this.requestMs, extractionMs: this.extractionMs, totalMs: Date.now() - this.started,
      requests: this.requests, retries: this.retries, ...fields });
  }
}

const TRANSIENT_HTTP = new Set([429, 502, 503, 504]);
export const MAX_REQUEST_ATTEMPTS = 2;
export const MAX_BACKOFF_MS = 1_000;
export const REQUEST_TIMEOUT_MS = 12_000;

export async function requestText(url: string | URL, init: RequestInit, trace: SourceTrace, kind: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ response: Response; text: string }> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    const remaining = trace.deadline - Date.now();
    if (remaining < 100) throw new CheckError('CHECK_BUDGET_EXHAUSTED');
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryAfter: number | null = null;
    let responseStatus: number | null = null;
    let accounted = false;
    trace.requests++; trace.budget.requests++;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetch(url, { ...init, signal: controller.signal });
          responseStatus = response.status;
          trace.httpStatus = response.status;
          if (TRANSIENT_HTTP.has(response.status)) {
            const header = response.headers.get('retry-after');
            if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1_000 : Math.max(0, Date.parse(header) - Date.now());
            await response.body?.cancel();
            throw new CheckError(`HTTP_${response.status}`, response.status, true);
          }
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let text = ''; let bytes = 0;
          if (reader) {
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > 1_500_000) { await reader.cancel(); throw new CheckError('RESPONSE_TOO_LARGE', response.status); }
                text += decoder.decode(chunk.value, { stream: true });
              }
              text += decoder.decode();
            } finally { reader.releaseLock(); }
          }
          return { response, text };
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          const budgetLimited = remaining < timeoutMs;
          reject(new CheckError(budgetLimited ? 'CHECK_BUDGET_EXHAUSTED' : 'FETCH_TIMEOUT', responseStatus, !budgetLimited));
          controller.abort();
        }, Math.min(timeoutMs, remaining)); }),
      ]);
      trace.log('source_request', { requestKind: kind, attempt: attempt + 1, httpStatus: result.response.status, elapsedMs: Date.now() - started });
      return result;
    } catch (error) {
      const failure = checkError(error);
      clearTimeout(timer);
      trace.requestMs += Date.now() - started;
      accounted = true;
      trace.httpStatus = failure.httpStatus;
      trace.log('source_request', { requestKind: kind, attempt: attempt + 1, errorCode: failure.code, httpStatus: failure.httpStatus, elapsedMs: Date.now() - started });
      const delay = retryAfter ?? 250 * (attempt + 1);
      // A long Retry-After means defer to the next natural check, not retry too early.
      if (!failure.transient || attempt + 1 >= MAX_REQUEST_ATTEMPTS || trace.budget.retriesLeft <= 0 || !Number.isFinite(delay) || delay > MAX_BACKOFF_MS || Date.now() + delay + 100 >= trace.deadline) throw failure;
      trace.budget.retriesLeft--; trace.budget.retries++; trace.retries++;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
      if (!accounted) trace.requestMs += Date.now() - started;
    }
  }
  throw new CheckError('CHECK_FAILED');
}
