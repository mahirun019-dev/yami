import { classifyChange, classifyFetchFailure, compareSnapshots, evaluateIdentity, fetchPage, findPlatformSharedChanges, hasCompatibleSnapshot, inspectRecruitmentContent, normalizeUrl, redactDiagnosticLine, serializeSnapshot, sha256 } from './monitor';
import type { RecruitmentAnalysis, SharedChangeCandidate, SnapshotChange } from './monitor';
import type { Env, EventType, SourceHealthStatus, SourceType, TargetRow } from './types';

const json = (body: unknown, status = 200, origin = '*') => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', vary: 'Origin' } });

async function authenticate(request: Request, env: Env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').bind(hash).first<{ expires_at: string }>();
  return Boolean(row && row.expires_at > new Date().toISOString());
}

async function createSession(request: Request, env: Env, origin: string) {
  const { code } = await request.json<{ code?: string }>();
  const requestCode = typeof code === 'string' ? code.trim() : '';
  const configuredCode = typeof env.WATCH_ACCESS_CODE === 'string' ? env.WATCH_ACCESS_CODE.trim() : '';
  const matches = Boolean(requestCode && configuredCode && (await sha256(requestCode)) === (await sha256(configuredCode)));
  if (!matches) return json({ error: 'AUTH_FAILED' }, 401, origin);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').bind(await sha256(token), expires, now.toISOString()).run();
  return json({ token, expiresAt: expires }, 201, origin);
}

const titles: Record<string, string> = {
  entry_open: 'エントリー受付が開始された可能性があります', briefing_open: '説明会情報が更新されました', internship_open: 'インターン情報が更新されました', deadline_changed: '締切情報の更新を検出しました', selection_updated: '選考情報の更新を検出しました', job_info_updated: '募集要項の更新を検出しました', recruitment_closed: '募集終了に関する更新を検出しました', other_recruitment_update: '採用情報の更新を検出しました'
};

const CHECK_LEASE_MS = 120_000;

type PendingEvent = {
  id: string;
  type: EventType;
  title: string;
  summary: string;
  beforeExcerpt: string;
  afterExcerpt: string;
  sourceUrl: string;
  contentHash: string;
  change: SnapshotChange;
  sharedCandidate: SharedChangeCandidate;
};

type PendingCheck = {
  target: TargetRow;
  lease: string;
  checkedAt: string;
  status: number;
  fetchedUrl: string;
  analysis: RecruitmentAnalysis;
  snapshot: string;
  hash: string;
  previousSnapshotHash: string | null;
  baseline: boolean;
  event: PendingEvent | null;
  runId: string;
  healthStatus: SourceHealthStatus;
  healthDetail: string | null;
  detectedCompanyName: string | null;
  snapshotUrl: string;
  snapshotSourceType: SourceType;
};

type SourceInspection = {
  healthStatus: SourceHealthStatus;
  healthDetail: string | null;
  detectedCompanyName: string | null;
  fetchedUrl: string;
  httpStatus: number;
  analysis: RecruitmentAnalysis;
  snapshot: string;
  hash: string;
};

function safeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

async function inspectSource(target: Pick<TargetRow, 'url' | 'source_type' | 'company_name'>): Promise<SourceInspection | { healthStatus: SourceHealthStatus; healthDetail: string; detectedCompanyName: null; fetchedUrl: string; httpStatus: number | null }> {
  let httpStatus: number | null = null;
  try {
    const fetched = await fetchPage(target.url);
    httpStatus = fetched.status;
    const analysis = inspectRecruitmentContent(fetched.html, target.source_type, fetched.url, target.company_name);
    const healthStatus = evaluateIdentity(analysis) || 'healthy';
    const healthDetail = healthStatus === 'identity_mismatch'
      ? 'IDENTITY_MISMATCH'
      : healthStatus === 'needs_review'
        ? 'IDENTITY_UNVERIFIED'
        : healthStatus === 'extraction_failed'
          ? 'INSUFFICIENT_PUBLIC_CONTENT'
          : null;
    const snapshot = serializeSnapshot(analysis);
    return { healthStatus, healthDetail, detectedCompanyName: analysis.detectedCompanyName, fetchedUrl: fetched.url, httpStatus: fetched.status, analysis, snapshot, hash: await sha256(snapshot) };
  } catch (error) {
    const healthDetail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return { healthStatus: classifyFetchFailure(healthDetail), healthDetail, detectedCompanyName: null, fetchedUrl: target.url, httpStatus: httpStatus ?? (healthDetail.match(/^HTTP_(\d{3})$/)?.[1] ? Number(healthDetail.slice(5)) : null) };
  }
}

function healthNotification(target: TargetRow, status: SourceHealthStatus, detail: string | null, detectedName: string | null) {
  const mismatch = status === 'identity_mismatch';
  const sourceChanged = status === 'source_changed';
  const title = status === 'healthy' ? '監視先を確認できました' : '監視先を確認してください';
  const summary = status === 'healthy'
    ? '監視先を再確認し、更新チェックを再開しました。'
    : mismatch
      ? `登録企業「${target.company_name}」と監視先の企業名${detectedName ? `「${detectedName}」` : ''}が一致しません。`
      : sourceChanged
        ? '監視先ページの構造が変わったため、基準情報を再作成しました。'
        : detail === 'LOGIN_REQUIRED' || detail === 'ACCESS_RESTRICTED'
          ? '監視先ページへのアクセスにログインまたは追加の権限が必要です。'
          : detail === 'INSUFFICIENT_PUBLIC_CONTENT'
            ? '監視先から企業固有の採用情報を確認できませんでした。'
            : detail === 'ROBOTS_DISALLOWED' || detail === 'ROBOTS_POLICY_UNVERIFIABLE'
              ? '監視先の取得可否を確認できないため、内容の更新チェックを停止しています。'
              : status === 'unreachable'
                ? '監視先ページにアクセスできないため、内容の更新チェックを停止しています。'
                : '登録企業との一致または採用情報の取得を確認できないため、内容の更新チェックを停止しています。';
  return { title, summary };
}

async function recordHealthTransition(env: Env, target: TargetRow, next: SourceHealthStatus, detail: string | null, detectedName: string | null, checkedAt: string) {
  const previous = target.health_status || null;
  if (previous === next || (previous === null && next === 'healthy')) return;
  const lastHealthEvent = await env.DB.prepare("SELECT after_excerpt FROM watch_events WHERE watch_target_id=? AND event_type IN ('source_health_issue','source_health_recovered') ORDER BY detected_at DESC LIMIT 1")
    .bind(target.id).first<{ after_excerpt: string | null }>();
  if (lastHealthEvent?.after_excerpt === next) return;
  const eventType: EventType = next === 'healthy' ? 'source_health_recovered' : 'source_health_issue';
  const copy = healthNotification(target, next, detail, detectedName);
  const contentHash = await sha256(`${target.id}|${previous || 'unverified'}|${next}|${checkedAt}`);
  await env.DB.prepare(`INSERT OR IGNORE INTO watch_events(id,company_id,company_name,watch_target_id,event_type,title,summary,before_excerpt,after_excerpt,detected_at,source_url,source_type,read,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,0,?)`)
    .bind(crypto.randomUUID(), target.company_id, target.company_name, target.id, eventType, copy.title, copy.summary, previous || 'unverified', next, checkedAt, target.url, target.source_type, contentHash).run();
}

function eventSummary(change: SnapshotChange, type: EventType): string {
  if (/説明会|セミナー/.test(change.sectionLabel)) return '説明会の内容または日程に変更がありました。';
  if (/募集要項|採用データ|応募資格|勤務条件|勤務地|待遇|福利厚生|初任給|給与|休日|休暇/.test(change.sectionLabel)) return '募集要項に変更がありました。';
  if (/選考/.test(change.sectionLabel)) return '選考情報に変更がありました。';
  const line = change.added[0]?.text || change.removed[0]?.text;
  return line ? `「${line.slice(0, 100)}」という採用情報の変更を検出しました。` : titles[type];
}

function buildPendingEvent(target: TargetRow, fetchedUrl: string, hash: string, change: SnapshotChange, runId: string): PendingEvent {
  const changedLines = change.added.length ? change.added.map((item) => item.text) : change.removed.map((item) => item.text);
  const type = classifyChange(changedLines, change.sectionLabel);
  const hostname = new URL(fetchedUrl).hostname;
  return {
    id: crypto.randomUUID(),
    type,
    title: titles[type],
    summary: eventSummary(change, type),
    beforeExcerpt: change.beforeExcerpt.slice(0, 1000),
    afterExcerpt: change.afterExcerpt.slice(0, 1000),
    sourceUrl: fetchedUrl,
    contentHash: hash,
    change,
    sharedCandidate: {
      targetId: target.id,
      companyId: target.company_id,
      host: hostname,
      selector: change.selector,
      sectionKey: change.sectionKey,
      scope: change.scope,
      text: change.sharedChange,
      runId,
    },
  };
}

function logCheck(check: PendingCheck, decision: string, notificationDiff: unknown = null) {
  const { target, analysis, event } = check;
  const change = event?.change;
  console.info(JSON.stringify({
    source: 'company-watch-diff',
    companyId: target.company_id,
    companyName: target.company_name,
    monitoredUrl: safeDiagnosticUrl(check.fetchedUrl),
    hostname: new URL(check.fetchedUrl).hostname,
    matchedContentSelector: analysis.selector,
    sectionSelectors: [...new Set(analysis.sections.map((section) => section.selector))],
    includedSections: analysis.sections.map((section) => ({ heading: section.label, selector: section.selector, normalizedTextLength: section.lines.join('\n').length })),
    excludedSections: analysis.excludedSections,
    companyIdentityMatched: analysis.identityMatched,
    snapshotHash: check.hash,
    previousSnapshotHash: check.previousSnapshotHash,
    rawDiff: {
      added: change?.normalizedAdded.map(redactDiagnosticLine) || [],
      removed: change?.normalizedRemoved.map(redactDiagnosticLine) || [],
    },
    normalizedDiff: {
      added: change?.added.map((item) => redactDiagnosticLine(item.text)) || [],
      removed: change?.removed.map((item) => redactDiagnosticLine(item.text)) || [],
    },
    ignoredDiff: analysis.ignored,
    notificationDiff,
    watchRunId: check.runId,
    timestamp: check.checkedAt,
    decision,
  }));
}

async function markTargetUnhealthy(env: Env, target: TargetRow, lease: string, checkedAt: string, httpStatus: number | null, healthStatus: SourceHealthStatus, detail: string, detectedName: string | null = null) {
  try { await recordHealthTransition(env, target, healthStatus, detail, detectedName, checkedAt); } catch (error) { console.error('SOURCE_HEALTH_EVENT_WRITE_FAILED', target.id, error); }
  await env.DB.prepare("UPDATE watch_targets SET status='error',last_checked_at=?,last_http_status=?,last_error=?,health_status=?,health_checked_at=?,health_detail=?,detected_company_name=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_until=? AND enabled=1")
    .bind(checkedAt, httpStatus, detail, healthStatus, checkedAt, detail, detectedName, checkedAt, target.id, lease).run();
}

async function finalizeCheck(env: Env, check: PendingCheck, sharedChanges: Set<string>) {
  const event = check.event;
  const shared = Boolean(event && sharedChanges.has(check.target.id));
  let decision = check.baseline ? 'baseline-created-or-rebuilt' : event ? (shared ? 'platform-shared-ignored' : 'notification') : 'no-meaningful-diff';
  let notificationDiff: unknown = null;
  try { await recordHealthTransition(env, check.target, check.healthStatus, check.healthDetail, check.detectedCompanyName, check.checkedAt); }
  catch (error) { console.error('SOURCE_HEALTH_EVENT_WRITE_FAILED', check.target.id, error); }
  if (event && !shared) {
    try {
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO watch_events(id,company_id,company_name,watch_target_id,event_type,title,summary,before_excerpt,after_excerpt,detected_at,source_url,source_type,read,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(event.id, check.target.company_id, check.target.company_name, check.target.id, event.type, event.title, event.summary, event.beforeExcerpt, event.afterExcerpt, check.checkedAt, event.sourceUrl, check.target.source_type, event.contentHash).run();
      if (!inserted.meta.changes) decision = 'notification-deduplicated';
      else notificationDiff = { type: event.type, section: event.change.sectionLabel, added: event.change.added.map((item) => redactDiagnosticLine(item.text)), removed: event.change.removed.map((item) => redactDiagnosticLine(item.text)) };
    } catch {
      await env.DB.prepare("UPDATE watch_targets SET status='error',last_checked_at=?,last_http_status=?,last_error='EVENT_WRITE_FAILED',lease_until=NULL,updated_at=? WHERE id=? AND lease_until=? AND enabled=1")
        .bind(check.checkedAt, check.status, check.checkedAt, check.target.id, check.lease).run();
      logCheck(check, 'event-write-failed');
      return;
    }
  }
  try {
    const storedStatus = check.healthStatus === 'healthy' || check.healthStatus === 'source_changed' ? 'active' : 'error';
    await env.DB.prepare("UPDATE watch_targets SET status=?,last_checked_at=?,last_success_at=?,last_http_status=?,last_hash=?,last_error=?,snapshot=?,snapshot_url=?,snapshot_source_type=?,health_status=?,health_checked_at=?,health_detail=?,detected_company_name=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_until=? AND enabled=1")
      .bind(storedStatus, check.checkedAt, check.checkedAt, check.status, check.hash, check.healthStatus === 'healthy' || check.healthStatus === 'source_changed' ? null : check.healthDetail, check.snapshot, check.snapshotUrl, check.snapshotSourceType, check.healthStatus, check.checkedAt, check.healthDetail, check.detectedCompanyName, check.checkedAt, check.target.id, check.lease).run();
  } catch {
    await markTargetUnhealthy(env, check.target, check.lease, check.checkedAt, check.status, 'extraction_failed', 'SNAPSHOT_WRITE_FAILED');
    logCheck(check, 'snapshot-write-failed', notificationDiff);
    return;
  }
  logCheck(check, decision, notificationDiff);
}

export async function checkTarget(env: Env, target: TargetRow, claimedLease?: string, batch?: PendingCheck[], runId = crypto.randomUUID(), healthOnly = false) {
  const now = new Date().toISOString();
  const lease = claimedLease || new Date(Date.now() + CHECK_LEASE_MS).toISOString();
  if (!claimedLease) {
    const lock = await env.DB.prepare("UPDATE watch_targets SET status='checking',last_error=NULL,last_http_status=NULL,lease_until=?,updated_at=? WHERE id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)")
      .bind(lease, now, target.id, now).run();
    if (!lock.meta.changes) return;
  }
  const inspection = await inspectSource(target);
  if (!('analysis' in inspection) || inspection.healthStatus !== 'healthy') {
    await markTargetUnhealthy(env, target, lease, now, inspection.httpStatus, inspection.healthStatus, inspection.healthDetail || 'HEALTH_VALIDATION_FAILED', inspection.detectedCompanyName);
    console.info(JSON.stringify({ source: 'company-watch-health', companyId: target.company_id, companyName: target.company_name, monitoredUrl: safeDiagnosticUrl(target.url), watchRunId: runId, timestamp: now, healthStatus: inspection.healthStatus, detectedCompanyName: inspection.detectedCompanyName, decision: 'diff-skipped' }));
    return;
  }
  const { analysis, snapshot, hash, fetchedUrl, httpStatus, detectedCompanyName } = inspection;
  const compatible = hasCompatibleSnapshot(target.snapshot, analysis);
  const sourceChanged = Boolean(target.snapshot && ((target.snapshot_url && target.snapshot_url !== target.normalized_url) || (target.snapshot_source_type && target.snapshot_source_type !== target.source_type) || !compatible));
  const recovering = Boolean(target.health_status && target.health_status !== 'healthy');
  const healthStatus: SourceHealthStatus = sourceChanged && !recovering ? 'source_changed' : 'healthy';
  const baseline = healthOnly || !target.snapshot || !compatible || sourceChanged || recovering || target.health_status !== 'healthy' || target.snapshot_url !== target.normalized_url || target.snapshot_source_type !== target.source_type;
  const change = !baseline && !healthOnly ? compareSnapshots(target.snapshot, analysis) : null;
  const previousSnapshotHash = target.last_hash || (target.snapshot ? await sha256(target.snapshot) : null);
  const event = change && hash !== target.last_hash ? buildPendingEvent(target, fetchedUrl, hash, change, runId) : null;
  const check: PendingCheck = { target, lease, checkedAt: now, status: httpStatus, fetchedUrl, analysis, snapshot, hash, previousSnapshotHash, baseline, event, runId, healthStatus, healthDetail: healthStatus === 'source_changed' ? 'SOURCE_STRUCTURE_CHANGED' : null, detectedCompanyName, snapshotUrl: target.normalized_url, snapshotSourceType: target.source_type };
  if (batch) batch.push(check);
  else await finalizeCheck(env, check, new Set());
}

async function queueTargetCheck(env: Env, ctx: ExecutionContext, target: TargetRow) {
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + CHECK_LEASE_MS).toISOString();
  const ready = await env.DB.prepare("UPDATE watch_targets SET status='checking',last_error=NULL,last_http_status=NULL,lease_until=?,updated_at=? WHERE id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)")
    .bind(lease, now, target.id, now).run();
  if (!ready.meta.changes) return false;
  const current = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(target.id).first<TargetRow>();
  if (!current) return false;
  ctx.waitUntil(checkTarget(env, current, lease));
  return true;
}

export async function scheduled(env: Env) {
  const rows = await env.DB.prepare("SELECT * FROM watch_targets WHERE enabled=1 ORDER BY COALESCE(last_checked_at,'') ASC").all<TargetRow>();
  const runId = crypto.randomUUID();
  const batch: PendingCheck[] = [];
  for (let index = 0; index < rows.results.length; index += 4) await Promise.all(rows.results.slice(index, index + 4).map((target) => checkTarget(env, target, undefined, batch, runId)));
  const sharedChanges = findPlatformSharedChanges(batch.flatMap((check) => check.event ? [check.event.sharedCandidate] : []));
  for (const check of batch) await finalizeCheck(env, check, sharedChanges);
}

function healthCounts(results: Array<{ healthStatus: SourceHealthStatus }>) {
  return results.reduce<Record<SourceHealthStatus, number>>((counts, item) => {
    counts[item.healthStatus] += 1;
    return counts;
  }, { healthy: 0, identity_mismatch: 0, extraction_failed: 0, unreachable: 0, auth_required: 0, source_changed: 0, needs_review: 0 });
}

async function readOnlyHealthAudit(env: Env) {
  const rows = await env.DB.prepare('SELECT * FROM watch_targets WHERE enabled=1 ORDER BY company_name,source_type').all<TargetRow>();
  const results: Array<Record<string, unknown> & { healthStatus: SourceHealthStatus }> = [];
  for (let index = 0; index < rows.results.length; index += 3) {
    const group = await Promise.all(rows.results.slice(index, index + 3).map(async (target) => {
      const inspection = await inspectSource(target);
      const snapshotState = !target.snapshot
        ? 'missing'
        : target.snapshot_url !== target.normalized_url || target.snapshot_source_type !== target.source_type
          ? 'source_changed'
          : 'analysis' in inspection && hasCompatibleSnapshot(target.snapshot, inspection.analysis) ? 'compatible' : 'needs_rebuild';
      let hostname = '';
      try { hostname = new URL(target.url).hostname; } catch { /* Keep an empty host for invalid legacy URLs. */ }
      return {
        targetId: target.id,
        companyId: target.company_id,
        companyName: target.company_name,
        watchEnabled: Boolean(target.enabled),
        sourceType: target.source_type,
        monitoredUrl: target.url,
        hostname,
        healthStatus: inspection.healthStatus,
        healthDetail: inspection.healthDetail,
        detectedCompanyName: inspection.detectedCompanyName,
        pageAccessible: inspection.httpStatus !== null && inspection.httpStatus >= 200 && inspection.httpStatus < 400,
        extractionSucceeded: 'analysis' in inspection ? inspection.analysis.valid : false,
        snapshotState,
        previousHealthCheckedAt: target.health_checked_at || null,
        lastBusinessCheckAt: target.last_checked_at,
      };
    }));
    results.push(...group);
  }
  return { checkedAt: new Date().toISOString(), readOnly: true, counts: healthCounts(results), results };
}

async function runManualHealthChecks(env: Env, targets: TargetRow[], leases: Map<string, string>) {
  for (let index = 0; index < targets.length; index += 3) {
    await Promise.all(targets.slice(index, index + 3).map((target) => {
      const lease = leases.get(target.id);
      return lease ? checkTarget(env, target, lease, undefined, crypto.randomUUID(), true) : Promise.resolve();
    }));
  }
}

function sourceHealthPayload(inspection: Awaited<ReturnType<typeof inspectSource>>) {
  let hostname = '';
  try { hostname = new URL(inspection.fetchedUrl).hostname; } catch { /* Keep an empty host for invalid URLs. */ }
  return { status: inspection.healthStatus, detail: inspection.healthDetail, detectedCompanyName: inspection.detectedCompanyName, currentUrl: inspection.fetchedUrl, hostname };
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(scheduled(env)); },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (origin && !allowed) return json({ error: 'ORIGIN_DENIED' }, 403, 'null');
    if (request.method === 'OPTIONS') return json({}, 204, origin || env.ALLOWED_ORIGIN);
    if (url.pathname === '/api/session' && request.method === 'POST') return createSession(request, env, origin);
    if (!(await authenticate(request, env))) return json({ error: 'UNAUTHORIZED' }, 401, origin);
    if (url.pathname === '/api/targets' && request.method === 'GET') {
      const [targets, events] = await Promise.all([env.DB.prepare('SELECT * FROM watch_targets ORDER BY created_at DESC').all(), env.DB.prepare('SELECT * FROM watch_events ORDER BY detected_at DESC LIMIT 100').all()]);
      return json({ targets: targets.results, events: events.results }, 200, origin);
    }
    if (url.pathname === '/api/health-check' && request.method === 'GET' && url.searchParams.get('dryRun') === '1') {
      return json(await readOnlyHealthAudit(env), 200, origin);
    }
    if (url.pathname === '/api/health-check' && request.method === 'POST') {
      const rows = await env.DB.prepare('SELECT * FROM watch_targets WHERE enabled=1 ORDER BY company_name,source_type').all<TargetRow>();
      const queuedIds: string[] = [];
      const leases = new Map<string, string>();
      const now = new Date().toISOString();
      for (const target of rows.results) {
        const lease = new Date(Date.now() + CHECK_LEASE_MS).toISOString();
        const lock = await env.DB.prepare("UPDATE watch_targets SET status='checking',lease_until=?,updated_at=? WHERE id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)")
          .bind(lease, now, target.id, now).run();
        if (!lock.meta.changes) continue;
        const current = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(target.id).first<TargetRow>();
        if (!current) continue;
        queuedIds.push(target.id);
        leases.set(target.id, lease);
      }
      ctx.waitUntil(runManualHealthChecks(env, rows.results.filter((target) => leases.has(target.id)), leases));
      return json({ queued: queuedIds.length, queuedIds, total: rows.results.length }, 202, origin);
    }
    if (url.pathname === '/api/targets' && request.method === 'POST') {
      const body = await request.json<{ companyId?: string; companyName?: string; sourceType?: SourceType; label?: string; url?: string; confirmUnverified?: boolean }>();
      if (!body.companyId || !body.companyName || !['mynavi','official','other'].includes(body.sourceType || '') || !body.url) return json({ error: 'INVALID_INPUT' }, 400, origin);
      let normalized: string;
      try { normalized = normalizeUrl(body.url); } catch (error) { return json({ error: error instanceof Error ? error.message : 'INVALID_URL' }, 400, origin); }
      const existing = await env.DB.prepare('SELECT * FROM watch_targets WHERE company_id=? AND normalized_url=?').bind(body.companyId, normalized).first<TargetRow>();
      if (existing) {
        const queued = existing.enabled ? await queueTargetCheck(env, ctx, existing) : false;
        return json({ id: existing.id, duplicate: true, queued, status: queued ? 'checking' : existing.status, lastError: existing.last_error || null }, 200, origin);
      }
      const sourceType = body.sourceType as SourceType;
      const inspected = await inspectSource({ url: normalized, source_type: sourceType, company_name: body.companyName });
      if (inspected.healthStatus !== 'healthy' && !body.confirmUnverified) {
        return json({ error: 'SOURCE_HEALTH_CONFIRMATION_REQUIRED', sourceHealth: sourceHealthPayload(inspected) }, 422, origin);
      }
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const healthy = inspected.healthStatus === 'healthy' && 'analysis' in inspected;
      const inserted = await env.DB.prepare("INSERT OR IGNORE INTO watch_targets(id,company_id,company_name,source_type,label,url,normalized_url,enabled,created_at,updated_at,status,last_checked_at,last_success_at,last_http_status,last_hash,last_error,snapshot,snapshot_url,snapshot_source_type,health_status,health_checked_at,health_detail,detected_company_name) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, body.companyId, body.companyName, sourceType, (body.label || '').trim(), normalized, normalized, now, now, healthy ? 'active' : 'error', now, healthy ? now : null, inspected.httpStatus, healthy && 'analysis' in inspected ? inspected.hash : null, healthy ? null : inspected.healthDetail, healthy && 'analysis' in inspected ? inspected.snapshot : null, healthy ? normalized : null, healthy ? sourceType : null, inspected.healthStatus, now, inspected.healthDetail, inspected.detectedCompanyName).run();
      const target = await env.DB.prepare('SELECT * FROM watch_targets WHERE company_id=? AND normalized_url=?').bind(body.companyId, normalized).first<TargetRow>();
      if (!target) return json({ error: 'TARGET_CREATE_FAILED' }, 500, origin);
      if (!inserted.meta.changes) return json({ id: target.id, duplicate: true, queued: false, status: target.status, lastError: target.last_error || null }, 200, origin);
      if (!healthy) {
        try { await recordHealthTransition(env, { ...target, health_status: null }, inspected.healthStatus, inspected.healthDetail, inspected.detectedCompanyName, now); }
        catch (error) { console.error('SOURCE_HEALTH_EVENT_WRITE_FAILED', target.id, error); }
      }
      return json({ id: target.id, duplicate: false, queued: false, status: target.status, lastError: target.last_error || null, sourceHealth: sourceHealthPayload(inspected) }, 201, origin);
    }
    const match = url.pathname.match(/^\/api\/targets\/([^/]+)(?:\/(retry))?$/);
    if (match) {
      const id = match[1];
      if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM watch_targets WHERE id=?').bind(id).run(); return json({}, 200, origin); }
      if (request.method === 'PATCH') {
        const body = await request.json<{ enabled?: boolean; label?: string; url?: string; sourceType?: SourceType; confirmUnverified?: boolean }>();
        const current = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        if (!current) return json({ error: 'NOT_FOUND' }, 404, origin);
        if (body.sourceType && !['mynavi','official','other'].includes(body.sourceType)) return json({ error: 'INVALID_SOURCE_TYPE' }, 400, origin);
        let normalized = current.normalized_url;
        try { if (body.url) normalized = normalizeUrl(body.url); } catch (error) { return json({ error: error instanceof Error ? error.message : 'INVALID_URL' }, 400, origin); }
        const sourceType = body.sourceType ?? current.source_type;
        const resetBaseline = normalized !== current.normalized_url || sourceType !== current.source_type;
        const enabled = body.enabled !== false;
        if (resetBaseline) {
          const duplicate = await env.DB.prepare('SELECT * FROM watch_targets WHERE company_id=? AND normalized_url=?').bind(current.company_id, normalized).first<TargetRow>();
          if (duplicate && duplicate.id !== current.id) return json({ error: 'DUPLICATE_URL' }, 409, origin);
          const inspected = await inspectSource({ url: normalized, source_type: sourceType, company_name: current.company_name });
          if (inspected.healthStatus !== 'healthy' && !body.confirmUnverified) {
            return json({ error: 'SOURCE_HEALTH_CONFIRMATION_REQUIRED', sourceHealth: sourceHealthPayload(inspected) }, 422, origin);
          }
          const healthy = inspected.healthStatus === 'healthy' && 'analysis' in inspected;
          const verified = healthy && 'analysis' in inspected ? inspected : null;
          const now = new Date().toISOString();
          try { await recordHealthTransition(env, current, inspected.healthStatus, inspected.healthDetail, inspected.detectedCompanyName, now); }
          catch (error) { console.error('SOURCE_HEALTH_EVENT_WRITE_FAILED', current.id, error); }
          await env.DB.prepare("UPDATE watch_targets SET enabled=?,status=?,last_error=?,last_http_status=?,lease_until=NULL,label=?,url=?,normalized_url=?,source_type=?,last_checked_at=?,last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,last_hash=CASE WHEN ?=1 THEN ? ELSE last_hash END,snapshot=CASE WHEN ?=1 THEN ? ELSE snapshot END,snapshot_url=CASE WHEN ?=1 THEN ? ELSE snapshot_url END,snapshot_source_type=CASE WHEN ?=1 THEN ? ELSE snapshot_source_type END,health_status=?,health_checked_at=?,health_detail=?,detected_company_name=?,updated_at=? WHERE id=?")
            .bind(enabled ? 1 : 0, !enabled ? 'paused' : healthy ? 'active' : 'error', healthy ? null : inspected.healthDetail, inspected.httpStatus, body.label ?? current.label, normalized, normalized, sourceType, now, healthy ? 1 : 0, now, healthy ? 1 : 0, verified?.hash ?? null, healthy ? 1 : 0, verified?.snapshot ?? null, healthy ? 1 : 0, normalized, healthy ? 1 : 0, sourceType, inspected.healthStatus, now, inspected.healthDetail, inspected.detectedCompanyName, now, id).run();
          const updated = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
          return json({ status: updated?.status || (healthy ? 'active' : 'error'), queued: false, lastError: updated?.last_error || null, sourceHealth: sourceHealthPayload(inspected) }, 200, origin);
        }
        await env.DB.prepare("UPDATE watch_targets SET enabled=?,status=?,last_error=NULL,last_http_status=NULL,lease_until=NULL,label=?,updated_at=? WHERE id=?")
          .bind(enabled ? 1 : 0, enabled ? 'checking' : 'paused', body.label ?? current.label, new Date().toISOString(), id).run();
        const updated = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        if (!updated) return json({ error: 'NOT_FOUND' }, 404, origin);
        const queued = enabled ? await queueTargetCheck(env, ctx, updated) : false;
        const latest = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        return json({ status: latest?.status || (enabled ? 'checking' : 'paused'), queued, lastError: latest?.last_error || null }, 200, origin);
      }
      if (request.method === 'POST' && match[2] === 'retry') {
        const target = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        if (!target) return json({ error: 'NOT_FOUND' }, 404, origin);
        const queued = target.enabled ? await queueTargetCheck(env, ctx, target) : false;
        const latest = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        return json({ status: latest?.status || target.status, queued, lastError: latest?.last_error || null }, 202, origin);
      }
    }
    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/read$/);
    if (eventMatch && request.method === 'POST') { await env.DB.prepare('UPDATE watch_events SET read=1 WHERE id=?').bind(eventMatch[1]).run(); return json({}, 200, origin); }
    if (url.pathname === '/api/events/read-all' && request.method === 'POST') { await env.DB.prepare('UPDATE watch_events SET read=1').run(); return json({}, 200, origin); }
    return json({ error: 'NOT_FOUND' }, 404, origin);
  }
};
