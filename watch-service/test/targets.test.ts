import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { scheduled } from '../src/index';
import type { TargetRow } from '../src/types';

type StoredTarget = TargetRow & { lease_until: string | null };

class MemoryD1 {
  targets = new Map<string, StoredTarget>();
  events = new Map<string, Record<string, unknown>>();
  writes = 0;

  prepare(sql: string) {
    const query = sql.replace(/\s+/g, ' ').trim();
    let values: unknown[] = [];
    const db = this;
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async first<T>() {
        if (query.startsWith('SELECT expires_at FROM sessions')) return { expires_at: new Date(Date.now() + 60_000).toISOString() } as T;
        if (query.startsWith('SELECT after_excerpt FROM watch_events')) {
          const latest = [...db.events.values()].filter((event) => event.watch_target_id === values[0] && ['source_health_issue', 'source_health_recovered'].includes(String(event.event_type))).sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))[0];
          return (latest ? { after_excerpt: latest.after_excerpt } : null) as T;
        }
        if (query.includes('WHERE company_id=? AND normalized_url=?')) return ([...db.targets.values()].find((row) => row.company_id === values[0] && row.normalized_url === values[1]) || null) as T;
        if (query.includes('WHERE id=?')) return (db.targets.get(String(values[0])) || null) as T;
        throw new Error(`Unsupported SELECT: ${query}`);
      },
      async run() {
        if (query.startsWith('INSERT OR IGNORE INTO watch_targets')) {
          const [id, company_id, company_name, source_type, label, url, normalized_url, created_at, updated_at, status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name] = values as [string, string, string, StoredTarget['source_type'], string, string, string, string, string, StoredTarget['status'], string, string | null, number | null, string | null, string | null, string | null, string | null, StoredTarget['source_type'] | null, StoredTarget['health_status'], string, string | null, string | null];
          const exists = [...db.targets.values()].some((row) => row.company_id === company_id && row.normalized_url === normalized_url);
          if (exists) return { meta: { changes: 0 } };
          db.writes += 1;
          db.targets.set(id, { id, company_id, company_name, source_type, label, url, normalized_url, enabled: 1, created_at, updated_at, status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('INSERT OR IGNORE INTO watch_events')) {
          const [id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read, content_hash] = values as unknown[];
          const duplicate = [...db.events.values()].some((event) => event.watch_target_id === watch_target_id && event.event_type === event_type && event.content_hash === content_hash);
          if (duplicate) return { meta: { changes: 0 } };
          db.writes += 1;
          db.events.set(String(id), { id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read, content_hash });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='checking'")) {
          const leaseIndex = query.includes('last_error=NULL') ? 0 : 0;
          const lease = String(values[leaseIndex]);
          const updatedAt = String(values[1]);
          const id = String(values[2]);
          const now = String(values[3]);
          const row = db.targets.get(id);
          if (!row || !row.enabled || (row.lease_until && row.lease_until >= now)) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status: 'checking', last_error: query.includes('last_error=NULL') ? null : row.last_error, last_http_status: query.includes('last_http_status=NULL') ? null : row.last_http_status, lease_until: lease, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('UPDATE watch_targets SET status=?,last_checked_at=?')) {
          const [status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at, id, lease_until] = values as [StoredTarget['status'], string, string, number, string, string | null, string, string, StoredTarget['source_type'], StoredTarget['health_status'], string, string | null, string | null, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease_until || !row.enabled) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='error',last_checked_at=?")) {
          const [last_checked_at, last_http_status, last_error, health_status, health_checked_at, health_detail, detected_company_name, updated_at, id, lease_until] = values as [string, number | null, string, StoredTarget['health_status'], string, string, string | null, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease_until || !row.enabled) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status: 'error', last_checked_at, last_http_status, last_error, health_status, health_checked_at, health_detail, detected_company_name, updated_at, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='error',last_checked_at=?,last_http_status=?,last_error='EVENT_WRITE_FAILED'")) {
          const [last_checked_at, last_http_status, updated_at, id, lease_until] = values as [string, number | null, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease_until) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status: 'error', last_checked_at, last_http_status, last_error: 'EVENT_WRITE_FAILED', updated_at, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('UPDATE watch_targets SET enabled=?,status=?,last_error=?,last_http_status=?,lease_until=NULL,label=?,url=?')) {
          const [enabled, status, last_error, last_http_status, label, url, normalized_url, source_type, last_checked_at, setSuccess, successAt, setHash, last_hash, setSnapshot, snapshot, setSnapshotUrl, snapshot_url, setSnapshotType, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at, id] = values as [number, StoredTarget['status'], string | null, number | null, string, string, string, StoredTarget['source_type'], string, number, string, number, string | null, number, string | null, number, string, number, StoredTarget['source_type'], StoredTarget['health_status'], string, string | null, string | null, string, string];
          const row = db.targets.get(id);
          if (!row) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { enabled, status, last_error, last_http_status, lease_until: null, label, url, normalized_url, source_type, last_checked_at, last_success_at: setSuccess ? successAt : row.last_success_at, last_hash: setHash ? last_hash : row.last_hash, snapshot: setSnapshot ? snapshot : row.snapshot, snapshot_url: setSnapshotUrl ? snapshot_url : row.snapshot_url, snapshot_source_type: setSnapshotType ? snapshot_source_type : row.snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('UPDATE watch_targets SET enabled=?,status=?,last_error=NULL')) {
          const [enabled, status, label, updated_at, id] = values as [number, StoredTarget['status'], string, string, string];
          const row = db.targets.get(id);
          if (!row) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { enabled, status, label, updated_at, lease_until: null, last_error: null, last_http_status: null });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unsupported UPDATE/INSERT: ${query}`);
      },
      async all<T>() {
        if (query.includes('FROM watch_targets')) {
          const rows = [...db.targets.values()].filter((row) => !query.includes('WHERE enabled=1') || row.enabled === 1);
          return { results: rows as T[] };
        }
        if (query.includes('FROM watch_events')) return { results: [...db.events.values()] as T[] };
        return { results: [] as T[] };
      },
    };
  }
}

const envFor = (db: MemoryD1) => ({ DB: db, WATCH_ACCESS_CODE: 'unused-in-session-auth', ALLOWED_ORIGIN: 'https://careerflow.example' }) as unknown as import('../src/types').Env;
const context = (pending: Promise<unknown>[]) => ({ waitUntil(promise: Promise<unknown>) { pending.push(promise); } }) as ExecutionContext;

async function addTarget(db: MemoryD1, body: Record<string, unknown>) {
  return worker.fetch(new Request('https://careerflow-watch.example.workers.dev/api/targets', {
    method: 'POST', headers: { authorization: 'Bearer test-session', origin: 'https://careerflow.example', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), envFor(db), context([]));
}

function mynaviHtml(companyName: string, holiday = '年間休日124日', recommendation = '(株)サクセス') {
  return `<html><body><div id="companyHead"><h1>${companyName}</h1><p>会社情報</p></div><form><div class="companyInfo"><section><h2>募集要項</h2><p>${holiday}</p><p>募集職種はシステムエンジニアです。</p><p>応募資格、勤務地、初任給を掲載しています。</p></section><section><h2>選考フロー</h2><p>書類選考、一次面接</p></section><div class="aiRecomend"><h2>おすすめ企業</h2><p>${recommendation}</p></div></div></form></body></html>`;
}

function setFetchPage(page: (url: string) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.22' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return page(url);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function target(overrides: Partial<StoredTarget> = {}): StoredTarget {
  const now = new Date().toISOString();
  const url = 'https://job.mynavi.jp/28/pc/search/corp292189/outline.html';
  return {
    id: 'aiming-mynavi', company_id: 'company-aiming', company_name: '株式会社Aiming', source_type: 'mynavi', label: '', url, normalized_url: url,
    enabled: 1, created_at: now, updated_at: now, last_checked_at: now, last_success_at: now, status: 'active', last_http_status: 200,
    last_hash: 'old-hash', last_error: null, snapshot: JSON.stringify({ version: 4, adapter: 'mynavi-v3', selector: 'mynavi-company-whitelist', sections: [{ label: '募集要項', selector: 'heading:h2', scope: 'company', lines: ['年間休日124日', '募集職種はシステムエンジニアです。'], meaningfulLines: ['年間休日124日', '募集職種はシステムエンジニアです。'] }] }),
    snapshot_url: url, snapshot_source_type: 'mynavi', health_status: 'healthy', health_checked_at: now, health_detail: null, detected_company_name: '(株)Aiming', lease_until: null,
    ...overrides,
  };
}

test('Aiming preflight blocks the Eighting MyNavi URL without writing; explicit confirmation records a separate health issue', async () => {
  const db = new MemoryD1();
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)エイティング'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const body = { companyId: 'company-aiming', companyName: '株式会社Aiming', sourceType: 'mynavi', url: 'https://job.mynavi.jp/28/pc/search/corp230455/outline.html' };
  try {
    const blocked = await addTarget(db, body);
    const details = await blocked.json() as { sourceHealth: { status: string; detectedCompanyName: string } };
    assert.equal(blocked.status, 422);
    assert.equal(details.sourceHealth.status, 'identity_mismatch');
    assert.equal(details.sourceHealth.detectedCompanyName, '(株)エイティング');
    assert.equal(db.targets.size, 0, 'mismatch is not silently stored');

    const confirmed = await addTarget(db, { ...body, confirmUnverified: true });
    assert.equal(confirmed.status, 201);
    const saved = [...db.targets.values()][0];
    assert.equal(saved.url, body.url);
    assert.equal(saved.health_status, 'identity_mismatch');
    assert.equal(saved.snapshot, null);
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'source_health_issue');
  } finally { restore(); }
});

test('scheduled mismatch skips all recruitment diffs, preserves the baseline, deduplicates unchanged health, and silently baselines on recovery', async () => {
  const db = new MemoryD1();
  const row = target();
  db.targets.set(row.id, row);
  let pageName = '(株)エイティング';
  let holiday = '年間休日125日';
  const restore = setFetchPage(() => new Response(mynaviHtml(pageName, holiday), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'identity_mismatch');
    assert.equal(row.snapshot?.includes('年間休日124日'), true, 'unhealthy checks keep the old snapshot bytes');
    assert.equal(row.last_hash, 'old-hash');
    assert.deepEqual([...db.events.values()].map((event) => event.event_type), ['source_health_issue']);

    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'same health state does not send another issue notice');
    pageName = '(株)Aiming';
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.equal(db.events.size, 2);
    assert.ok([...db.events.values()].some((event) => event.event_type === 'source_health_recovered'));
    assert.ok(![...db.events.values()].some((event) => String(event.event_type).includes('updated')));
    assert.equal(row.snapshot?.includes('年間休日125日'), true, 'recovery writes a fresh baseline without diffing against the stale one');

    holiday = '年間休日126日';
    await scheduled(envFor(db));
    assert.ok([...db.events.values()].some((event) => event.event_type === 'job_info_updated'));
  } finally { restore(); }
});

test('a changed page structure is marked source_changed and its snapshot is rebuilt without a recruitment event', async () => {
  const db = new MemoryD1();
  const row = target({ snapshot_source_type: 'other' });
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'source_changed');
    assert.equal(row.snapshot_source_type, 'mynavi');
    assert.deepEqual([...db.events.values()].map((event) => event.event_type), ['source_health_issue']);
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.ok([...db.events.values()].some((event) => event.event_type === 'source_health_recovered'));
    assert.ok(![...db.events.values()].some((event) => String(event.event_type).includes('updated')));
  } finally { restore(); }
});

test('healthy company-specific changes still generate recruitment notifications after a trusted baseline', async () => {
  const db = new MemoryD1();
  const row = target({ snapshot: null, last_hash: null, snapshot_url: null, snapshot_source_type: null, health_status: null, detected_company_name: null });
  db.targets.set(row.id, row);
  let holiday = '年間休日124日';
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming', holiday), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(db.events.size, 0, 'first valid check only establishes a baseline');
    holiday = '年間休日125日';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'job_info_updated');
  } finally { restore(); }
});

test('read-only audit scans enabled sources and performs no D1 writes', async () => {
  const db = new MemoryD1();
  const row = target();
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    const response = await worker.fetch(new Request('https://careerflow-watch.example.workers.dev/api/health-check?dryRun=1', {
      headers: { authorization: 'Bearer test-session', origin: 'https://careerflow.example' },
    }), envFor(db), context([]));
    const report = await response.json() as { readOnly: boolean; counts: { healthy: number }; results: Array<{ healthStatus: string; companyName: string; snapshotState: string }> };
    assert.equal(response.status, 200);
    assert.equal(report.readOnly, true);
    assert.equal(report.counts.healthy, 1);
    assert.equal(report.results[0].companyName, '株式会社Aiming');
    assert.equal(report.results[0].snapshotState, 'compatible');
    assert.equal(db.writes, 0);
  } finally { restore(); }
});

test('changing a URL to an identity mismatch requires confirmation and preserves the old snapshot and URL until then', async () => {
  const db = new MemoryD1();
  const row = target({ id: 'edit-target' });
  db.targets.set(row.id, row);
  const oldUrl = row.url, oldSnapshot = row.snapshot;
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)エイティング'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const request = (confirmUnverified = false) => worker.fetch(new Request(`https://careerflow-watch.example.workers.dev/api/targets/${row.id}`, {
    method: 'PATCH', headers: { authorization: 'Bearer test-session', origin: 'https://careerflow.example', 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://job.mynavi.jp/28/pc/search/corp230455/outline.html', sourceType: 'mynavi', confirmUnverified }),
  }), envFor(db), context([]));
  try {
    const blocked = await request();
    assert.equal(blocked.status, 422);
    assert.equal(row.url, oldUrl);
    assert.equal(row.snapshot, oldSnapshot);
    const confirmed = await request(true);
    assert.equal(confirmed.status, 200);
    assert.equal(row.url, 'https://job.mynavi.jp/28/pc/search/corp230455/outline.html');
    assert.equal(row.health_status, 'identity_mismatch');
    assert.equal(row.snapshot, oldSnapshot, 'confirming an unhealthy source still keeps the old snapshot intact');
  } finally { restore(); }
});
