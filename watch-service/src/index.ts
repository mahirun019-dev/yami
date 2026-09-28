import { classifyChange, compareSnapshots, fetchPage, findPlatformSharedChanges, hasCompatibleSnapshot, inspectRecruitmentContent, normalizeUrl, redactDiagnosticLine, serializeSnapshot, sha256 } from './monitor';
import type { RecruitmentAnalysis, SharedChangeCandidate, SnapshotChange } from './monitor';
import type { Env, EventType, SourceType, TargetRow } from './types';

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
};

function safeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
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

async function markTargetError(env: Env, target: TargetRow, lease: string, checkedAt: string, status: number | null, message: string) {
  await env.DB.prepare("UPDATE watch_targets SET status='error',last_checked_at=?,last_http_status=?,last_error=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_until=? AND enabled=1")
    .bind(checkedAt, status, message, checkedAt, target.id, lease).run();
}

async function finalizeCheck(env: Env, check: PendingCheck, sharedChanges: Set<string>) {
  const event = check.event;
  const shared = Boolean(event && sharedChanges.has(check.target.id));
  let decision = check.baseline ? 'baseline-created-or-rebuilt' : event ? (shared ? 'platform-shared-ignored' : 'notification') : 'no-meaningful-diff';
  let notificationDiff: unknown = null;
  if (event && !shared) {
    try {
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO watch_events(id,company_id,company_name,watch_target_id,event_type,title,summary,before_excerpt,after_excerpt,detected_at,source_url,source_type,read,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(event.id, check.target.company_id, check.target.company_name, check.target.id, event.type, event.title, event.summary, event.beforeExcerpt, event.afterExcerpt, check.checkedAt, event.sourceUrl, check.target.source_type, event.contentHash).run();
      if (!inserted.meta.changes) decision = 'notification-deduplicated';
      else notificationDiff = { type: event.type, section: event.change.sectionLabel, added: event.change.added.map((item) => redactDiagnosticLine(item.text)), removed: event.change.removed.map((item) => redactDiagnosticLine(item.text)) };
    } catch {
      await markTargetError(env, check.target, check.lease, check.checkedAt, check.status, 'EVENT_WRITE_FAILED');
      logCheck(check, 'event-write-failed');
      return;
    }
  }
  try {
    await env.DB.prepare("UPDATE watch_targets SET status='active',last_checked_at=?,last_success_at=?,last_http_status=?,last_hash=?,last_error=NULL,snapshot=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_until=? AND enabled=1")
      .bind(check.checkedAt, check.checkedAt, check.status, check.hash, check.snapshot, check.checkedAt, check.target.id, check.lease).run();
  } catch {
    await markTargetError(env, check.target, check.lease, check.checkedAt, check.status, 'SNAPSHOT_WRITE_FAILED');
    logCheck(check, 'snapshot-write-failed', notificationDiff);
    return;
  }
  logCheck(check, decision, notificationDiff);
}

export async function checkTarget(env: Env, target: TargetRow, claimedLease?: string, batch?: PendingCheck[], runId = crypto.randomUUID()) {
  const now = new Date().toISOString();
  const lease = claimedLease || new Date(Date.now() + CHECK_LEASE_MS).toISOString();
  if (!claimedLease) {
    const lock = await env.DB.prepare("UPDATE watch_targets SET status='checking',last_error=NULL,last_http_status=NULL,lease_until=?,updated_at=? WHERE id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)")
      .bind(lease, now, target.id, now).run();
    if (!lock.meta.changes) return;
  }
  let checkedHttpStatus: number | null = null;
  try {
    const fetched = await fetchPage(target.url);
    checkedHttpStatus = fetched.status;
    const analysis = inspectRecruitmentContent(fetched.html, target.source_type, fetched.url);
    if (!analysis.valid) throw new Error('INSUFFICIENT_PUBLIC_CONTENT');
    const snapshot = serializeSnapshot(analysis);
    const hash = await sha256(snapshot);
    const compatible = hasCompatibleSnapshot(target.snapshot, analysis);
    const change = compatible ? compareSnapshots(target.snapshot, analysis) : null;
    const previousSnapshotHash = target.last_hash || (target.snapshot ? await sha256(target.snapshot) : null);
    const event = change && hash !== target.last_hash ? buildPendingEvent(target, fetched.url, hash, change, runId) : null;
    const check: PendingCheck = { target, lease, checkedAt: now, status: fetched.status, fetchedUrl: fetched.url, analysis, snapshot, hash, previousSnapshotHash, baseline: !compatible, event, runId };
    if (batch) batch.push(check);
    else await finalizeCheck(env, check, new Set());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    await markTargetError(env, target, lease, now, checkedHttpStatus, message);
    console.info(JSON.stringify({ source: 'company-watch-diff', companyId: target.company_id, companyName: target.company_name, monitoredUrl: safeDiagnosticUrl(target.url), watchRunId: runId, timestamp: now, decision: 'check-failed', error: message }));
  }
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
  const rows = await env.DB.prepare("SELECT * FROM watch_targets WHERE enabled=1 AND status!='paused' ORDER BY COALESCE(last_checked_at,'') ASC LIMIT 12").all<TargetRow>();
  const runId = crypto.randomUUID();
  const batch: PendingCheck[] = [];
  for (const target of rows.results) await checkTarget(env, target, undefined, batch, runId);
  const sharedChanges = findPlatformSharedChanges(batch.flatMap((check) => check.event ? [check.event.sharedCandidate] : []));
  for (const check of batch) await finalizeCheck(env, check, sharedChanges);
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
    if (url.pathname === '/api/targets' && request.method === 'POST') {
      const body = await request.json<{ companyId?: string; companyName?: string; sourceType?: SourceType; label?: string; url?: string }>();
      if (!body.companyId || !body.companyName || !['mynavi','official','other'].includes(body.sourceType || '') || !body.url) return json({ error: 'INVALID_INPUT' }, 400, origin);
      let normalized: string;
      try { normalized = normalizeUrl(body.url); } catch (error) { return json({ error: error instanceof Error ? error.message : 'INVALID_URL' }, 400, origin); }
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const inserted = await env.DB.prepare("INSERT OR IGNORE INTO watch_targets(id,company_id,company_name,source_type,label,url,normalized_url,enabled,created_at,updated_at,status) VALUES(?,?,?,?,?,?,?,1,?,?,'checking')")
        .bind(id, body.companyId, body.companyName, body.sourceType, (body.label || '').trim(), normalized, normalized, now, now).run();
      const target = await env.DB.prepare('SELECT * FROM watch_targets WHERE company_id=? AND normalized_url=?').bind(body.companyId, normalized).first<TargetRow>();
      if (!target) return json({ error: 'TARGET_CREATE_FAILED' }, 500, origin);
      const duplicate = inserted.meta.changes === 0;
      const queued = target.enabled ? await queueTargetCheck(env, ctx, target) : false;
      const latest = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(target.id).first<TargetRow>();
      return json({ id: target.id, duplicate, queued, status: latest?.status || (target.enabled ? 'checking' : 'paused'), lastError: latest?.last_error || null }, duplicate ? 200 : 201, origin);
    }
    const match = url.pathname.match(/^\/api\/targets\/([^/]+)(?:\/(retry))?$/);
    if (match) {
      const id = match[1];
      if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM watch_targets WHERE id=?').bind(id).run(); return json({}, 200, origin); }
      if (request.method === 'PATCH') {
        const body = await request.json<{ enabled?: boolean; label?: string; url?: string; sourceType?: SourceType }>();
        const current = await env.DB.prepare('SELECT * FROM watch_targets WHERE id=?').bind(id).first<TargetRow>();
        if (!current) return json({ error: 'NOT_FOUND' }, 404, origin);
        if (body.sourceType && !['mynavi','official','other'].includes(body.sourceType)) return json({ error: 'INVALID_SOURCE_TYPE' }, 400, origin);
        let normalized = current.normalized_url;
        try { if (body.url) normalized = normalizeUrl(body.url); } catch (error) { return json({ error: error instanceof Error ? error.message : 'INVALID_URL' }, 400, origin); }
        const enabled = body.enabled !== false;
        const sourceType = body.sourceType ?? current.source_type;
        const resetBaseline = normalized !== current.normalized_url || sourceType !== current.source_type;
        await env.DB.prepare("UPDATE watch_targets SET enabled=?,status=?,last_error=NULL,last_http_status=NULL,lease_until=NULL,label=?,url=?,normalized_url=?,source_type=?,snapshot=CASE WHEN ?=1 THEN NULL ELSE snapshot END,last_hash=CASE WHEN ?=1 THEN NULL ELSE last_hash END,updated_at=? WHERE id=?")
          .bind(enabled ? 1 : 0, enabled ? 'checking' : 'paused', body.label ?? current.label, normalized, normalized, sourceType, resetBaseline ? 1 : 0, resetBaseline ? 1 : 0, new Date().toISOString(), id).run();
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
