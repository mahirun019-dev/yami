import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { checkTarget, scheduled } from '../src/index';
import { SourceTrace, runBudget } from '../src/reliability';
import type { TargetRow } from '../src/types';

type StoredTarget = TargetRow & { lease_until: string | null };

class MemoryD1 {
  targets = new Map<string, StoredTarget>();
  events = new Map<string, Record<string, unknown>>();
  writes = 0;

  async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

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
        if (query.startsWith('SELECT entry_status FROM watch_targets')) {
          const row = db.targets.get(String(values[0]));
          return (row && row.lease_until === values[1] && row.enabled ? { entry_status: row.entry_status ?? null } : null) as T;
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
          if (query.includes('SELECT ?')) {
            const [id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, content_hash, target_id, entry_status, changed_at, last_checked_at] = values as unknown[];
            const row = db.targets.get(String(target_id));
            if (query.includes('lease_until=?')) {
              if (!row || !row.enabled || row.lease_until !== entry_status) return { meta: { changes: 0 } };
            } else if (!row || row.entry_status !== entry_status || row.entry_status_changed_at !== changed_at || row.last_checked_at !== last_checked_at || row.status !== 'active') return { meta: { changes: 0 } };
            const duplicate = [...db.events.values()].some((event) => event.watch_target_id === watch_target_id && event.event_type === event_type && event.content_hash === content_hash);
            if (duplicate) return { meta: { changes: 0 } };
            db.writes += 1;
            db.events.set(String(id), { id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read: 0, content_hash });
            return { meta: { changes: 1 } };
          }
          const [id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, content_hash] = values as unknown[];
          const duplicate = [...db.events.values()].some((event) => event.watch_target_id === watch_target_id && event.event_type === event_type && event.content_hash === content_hash);
          if (duplicate) return { meta: { changes: 0 } };
          db.writes += 1;
          db.events.set(String(id), { id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read: 0, content_hash });
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
        if (query.startsWith("UPDATE watch_targets SET status='active',last_checked_at=?")) {
          const [last_checked_at, last_success_at, last_http_status, health_checked_at, detected_company_name, entry_status, _entry_status_again, checkedAt, entry_last_checked_at, entry_url, entry_signal, updated_at, id, lease_until] = values as unknown[];
          const row = db.targets.get(String(id));
          if (!row || row.lease_until !== lease_until || !row.enabled) return { meta: { changes: 0 } };
          db.writes += 1;
          const changed = row.entry_status !== entry_status;
          Object.assign(row, {
            status: 'active', last_checked_at, last_success_at, last_http_status, last_error: null,
            health_status: 'healthy', health_checked_at, health_detail: null, detected_company_name,
            transient_failure_count: 0, health_failure_run_id: null, health_alerted_at: null,
            entry_status, entry_status_changed_at: changed || !row.entry_status_changed_at ? checkedAt : row.entry_status_changed_at,
            entry_last_checked_at, entry_url, entry_signal, lease_until: null, updated_at,
          });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('UPDATE watch_targets SET status=?,last_checked_at=?')) {
          const [status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at, id, lease_until] = values as [StoredTarget['status'], string, string, number, string, string | null, string, string, StoredTarget['source_type'], StoredTarget['health_status'], string, string | null, string | null, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease_until || !row.enabled) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status, last_checked_at, last_success_at, last_http_status, last_hash, last_error, snapshot, snapshot_url, snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, updated_at, lease_until: null, transient_failure_count: 0, health_failure_run_id: null, health_alerted_at: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='error',last_checked_at=?") && query.includes('health_status=?')) {
          const [last_checked_at, last_http_status, last_error, health_status, health_checked_at, health_detail, detected_company_name, transient_failure_count, health_failure_run_id, health_alerted_at, updated_at, id, lease_until] = values as [string, number | null, string, StoredTarget['health_status'], string, string, string | null, number, string | null, string | null, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease_until || !row.enabled) return { meta: { changes: 0 } };
          db.writes += 1;
          Object.assign(row, { status: 'error', last_checked_at, last_http_status, last_error, health_status, health_checked_at, health_detail, detected_company_name, transient_failure_count, health_failure_run_id, health_alerted_at, updated_at, lease_until: null });
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
          Object.assign(row, { enabled, status, last_error, last_http_status, lease_until: null, label, url, normalized_url, source_type, last_checked_at, last_success_at: setSuccess ? successAt : row.last_success_at, last_hash: setHash ? last_hash : row.last_hash, snapshot: setSnapshot ? snapshot : row.snapshot, snapshot_url: setSnapshotUrl ? snapshot_url : row.snapshot_url, snapshot_source_type: setSnapshotType ? snapshot_source_type : row.snapshot_source_type, health_status, health_checked_at, health_detail, detected_company_name, entry_status: null, entry_status_changed_at: null, entry_last_checked_at: null, entry_url: null, entry_signal: null, updated_at });
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
        if (query.startsWith('UPDATE watch_targets SET status=?,lease_until=NULL')) {
          const [status, id, lease] = values;
          const row = db.targets.get(String(id));
          if (!row || !row.enabled || row.lease_until !== lease) return { meta: { changes: 0 } };
          Object.assign(row, { status, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='active',health_status='healthy'")) {
          const [health_checked_at, id, lease] = values;
          const row = db.targets.get(String(id));
          if (!row || !row.enabled || row.lease_until !== lease) return { meta: { changes: 0 } };
          Object.assign(row, { status: 'active', health_status: 'healthy', health_checked_at, health_detail: null, last_error: null, transient_failure_count: 0, health_failure_run_id: null, health_alerted_at: null, lease_until: null });
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

function mynaviHtml(companyName: string, holiday = '年間休日124日', recommendation = '(株)サクセス', entryMarkup = '') {
  return `<html><body><div id="companyHead"><h1>${companyName}</h1><p>会社情報</p></div><form><div class="companyInfo"><section><h2>募集要項</h2><p>${holiday}</p><p>募集職種はシステムエンジニアです。</p><p>応募資格、勤務地、初任給を掲載しています。</p></section><section><h2>選考フロー</h2><p>書類選考、一次面接</p></section>${entryMarkup}<div class="aiRecomend"><h2>おすすめ企業</h2><p>${recommendation}</p></div></div></form></body></html>`;
}

function officialHtml(companyName: string, holiday: string) {
  return `<html><body><main><h1>${companyName}</h1><section><h2>募集要項</h2><p>年間休日${holiday}</p><p>募集職種はシステムエンジニアです。</p><p>応募資格、勤務地、初任給、福利厚生を掲載しています。</p></section></main></body></html>`;
}

const mixiListUrl = 'https://mixigroup-recruit.mixi.co.jp/jobs/?cats=new-graduate&tags=';
const mixiJobUrl = 'https://mixigroup-recruit.mixi.co.jp/recruitment-category/new-graduate/14426/';
const aimingHrmosUrl = 'https://hrmos.co/pages/aiming/jobs/2210232845074915332';

function mixiListingHtml() {
  return `<html><head><link rel="https://api.w.org/" href="https://mixigroup-recruit.mixi.co.jp/wp-json/"></head><body><script>mixiObj.catSlugToIdConversionTable = JSON.parse('{"new-graduate":113}');</script><main><p class="no-result" style="display:none">募集が見つかりませんでした。</p></main></body></html>`;
}

function mixiApiPosts(title = '【2028年】【エンジニア職】MIXI新卒採用') {
  return [{ id: 14426, status: 'publish', title: { rendered: title }, link: mixiJobUrl, categories: [113, 118] }];
}

function mixiJobHtml(extraDetail = '') {
  return `<html><head><title>【2028年】【エンジニア職】MIXI新卒採用 - MIXI GROUP RECRUIT</title></head><body><header>共通ナビ</header><div id="content"><h1>【2028年】【エンジニア職】MIXI新卒採用</h1><div class="wrapper ml"><h2>概要</h2><dl><dt>採用メッセージ</dt><dd>2027年10月または2028年4月入社予定のエンジニア採用です。</dd></dl><h2>募集内容</h2><dl><dt>職務内容</dt><dd>MIXIのゲームやWebサービスを開発し、インフラ・SRE・データ基盤の業務にも携わります。${extraDetail}</dd></dl><h2>応募条件</h2><dl><dt>必須要件</dt><dd>ソフトウェア開発経験があり、2028年に入社可能な方。</dd></dl></div><a href="https://mixi-recruit.snar.jp/entry.aspx?entryid=public-entry">エントリーする</a></div></body></html>`;
}

function aimingHrmosHtml(companyName = '株式会社Aiming', extraDetail = '') {
  return `<html><head><title>[28卒]インフラエンジニア | ${companyName}</title><link rel="canonical" href="${aimingHrmosUrl}"></head><body><main><h1>[28卒]インフラエンジニア</h1><article class="pg-body"><section class="pg-markdown"><blockquote><p>具体的な仕事内容</p></blockquote><p>ゲームサーバのクラウド選定、システム設計、構築、運用管理、セキュリティ対応を担当します。社内インフラ整備と開発環境の運用も行います。${extraDetail}</p></section><section class="pg-descriptions"><table><tr><th>職種 / 募集ポジション</th><td>[28卒]インフラエンジニア</td></tr><tr><th>応募資格</th><td>2028年3月卒業者</td></tr></table></section><section class="pg-apply-box"><a class="jsc-apply-trigger" href="${aimingHrmosUrl}/apply">応募する</a></section></article><section class="pg-descriptions"><table><caption>会社情報</caption><tr><th>会社名</th><td>${companyName}</td></tr></table></section></main></body></html>`;
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

test('a transient 503 retries successfully without a health notification', async () => {
  const db = new MemoryD1(); const row = target(); db.targets.set(row.id, row);
  let attempts = 0;
  const restore = setFetchPage(() => ++attempts === 1 ? new Response('', { status: 503 }) : new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(attempts, 2); assert.equal(row.health_status, 'healthy'); assert.equal(db.events.size, 0);
  } finally { restore(); }
});

test('two natural failures alert once; ongoing failure is silent; recovery permits a new incident', async () => {
  const db = new MemoryD1(); const row = target(); db.targets.set(row.id, row);
  let fail = true;
  const restore = setFetchPage(() => fail ? new Response('', { status: 503, headers: { 'retry-after': '60' } }) : new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db)); assert.equal(db.events.size, 0); assert.equal(row.transient_failure_count, 1); assert.equal(row.last_http_status, 503);
    await scheduled(envFor(db)); assert.equal(db.events.size, 1); assert.equal(row.transient_failure_count, 2);
    await scheduled(envFor(db)); assert.equal(db.events.size, 1);
    fail = false; await scheduled(envFor(db)); assert.equal(row.transient_failure_count, 0); assert.equal(row.health_alerted_at, null);
    fail = true; await scheduled(envFor(db)); assert.equal(db.events.size, 1);
    await scheduled(envFor(db)); assert.equal(db.events.size, 2);
  } finally { restore(); }
});

test('retries and manual checks cannot count as additional natural rounds', async () => {
  const db = new MemoryD1(); const row = target(); db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response('', { status: 503, headers: { 'retry-after': '60' } }));
  try {
    await checkTarget(envFor(db), { ...row }); assert.equal(row.transient_failure_count, 0); assert.equal(db.events.size, 0);
    const budget = runBudget();
    await checkTarget(envFor(db), { ...row }, undefined, undefined, 'same-run', false, new SourceTrace(row, 'same-run', budget, true));
    await checkTarget(envFor(db), { ...row }, undefined, undefined, 'same-run', false, new SourceTrace(row, 'same-run', budget, true));
    assert.equal(row.transient_failure_count, 1); assert.equal(db.events.size, 0);
    await scheduled(envFor(db)); assert.equal(db.events.size, 1);
  } finally { restore(); }
});

for (const changed of [false, true]) test(`valid official baseline survives failure and recovery (${changed ? 'changed, one update' : 'unchanged, silent'})`, async () => {
  const db = new MemoryD1(); const url = 'https://example.com/recruit/';
  const row = target({ id: 'official', source_type: 'official', url, normalized_url: url, snapshot: null, snapshot_url: null, snapshot_source_type: null, last_hash: null }); db.targets.set(row.id, row);
  let fail = false; let holiday = '124日';
  const restore = setFetchPage(() => fail ? new Response('', { status: 503, headers: { 'retry-after': '60' } }) : new Response(officialHtml('株式会社Aiming', holiday), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db)); const baseline = row.snapshot; const hash = row.last_hash; const lastSuccess = row.last_success_at;
    assert.ok(baseline); assert.equal(db.events.size, 0);
    fail = true; await scheduled(envFor(db));
    assert.equal(row.snapshot, baseline); assert.equal(row.last_hash, hash); assert.equal(row.last_success_at, lastSuccess);
    fail = false; if (changed) holiday = '130日';
    await scheduled(envFor(db));
    assert.equal(db.events.size, changed ? 1 : 0); assert.equal(row.health_status, 'healthy');
    await scheduled(envFor(db)); assert.equal(db.events.size, changed ? 1 : 0);
  } finally { restore(); }
});

test('a parseable but empty compatible snapshot is silently replaced, not diffed', async () => {
  const db = new MemoryD1(); const url = 'https://example.com/recruit/';
  const row = target({ source_type: 'official', url, normalized_url: url, snapshot: null, snapshot_url: url, snapshot_source_type: 'official' }); db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(officialHtml('株式会社Aiming', '124日'), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db));
    const invalid = JSON.parse(row.snapshot!); invalid.sections = [{ label: '募集要項', selector: 'main', scope: 'company', lines: ['募集が見つかりませんでした'], meaningfulLines: [] }];
    row.snapshot = JSON.stringify(invalid); row.health_status = 'extraction_failed';
    await scheduled(envFor(db)); assert.equal(db.events.size, 0); assert.match(row.snapshot!, /年間休日124日/);
  } finally { restore(); }
});

test('MyNavi sustained open and failure-to-open recovery never emit a reopened event', async () => {
  const db = new MemoryD1(); const row = target({ entry_status: 'open', entry_url: 'https://job.mynavi.jp/entry' }); db.targets.set(row.id, row);
  let fail = false;
  const restore = setFetchPage(() => fail ? new Response('', { status: 503, headers: { 'retry-after': '60' } }) : new Response(mynaviHtml('(株)Aiming', '年間休日124日', '(株)サクセス', '<a href="/entry">エントリー</a>'), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db)); fail = true; await scheduled(envFor(db)); assert.equal(row.entry_status, 'open');
    fail = false; await scheduled(envFor(db)); await scheduled(envFor(db));
    assert.equal(row.entry_status, 'open'); assert.equal(db.events.size, 0);
  } finally { restore(); }
});

test('a source persistence exception does not interrupt other sources', async () => {
  const db = new MemoryD1(); const bad = target({ id: 'broken' }); const good = target({ id: 'good', company_id: 'good' });
  db.targets.set(bad.id, bad); db.targets.set(good.id, good);
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (sql.startsWith("UPDATE watch_targets SET status='checking'")) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...args: unknown[]) => { bind(...args); if (args[2] === 'broken') statement.run = async () => { throw new Error('SECRET_DATABASE_EXCEPTION'); }; return statement; };
    }
    return statement;
  };
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html' } }));
  try {
    await assert.rejects(scheduled(envFor(db)), /WATCH_RUN_INCOMPLETE/);
    assert.equal(good.health_status, 'healthy'); assert.equal(good.status, 'active'); assert.equal(good.entry_status, 'unavailable');
  } finally { restore(); }
});

test('MIXI downstream API failure records its actual 503, not the listing HTTP 200', async () => {
  const db = new MemoryD1(); const row = target({ company_name: '株式会社MIXI', source_type: 'official', url: mixiListUrl, normalized_url: mixiListUrl }); db.targets.set(row.id, row);
  const restore = setFetchPage((url) => url.includes('/wp-json/') ? new Response('', { status: 503, headers: { 'retry-after': '60' } }) : new Response(mixiListingHtml(), { headers: { 'content-type': 'text/html' } }));
  try { await scheduled(envFor(db)); assert.equal(row.last_http_status, 503); assert.equal(row.health_detail, 'HTTP_503'); assert.equal(db.events.size, 0); }
  finally { restore(); }
});

test('execution budget exhaustion is deferred without changing source health, snapshot or checked time', async () => {
  const db = new MemoryD1(); const row = target(); db.targets.set(row.id, row);
  const before = { ...row };
  await checkTarget(envFor(db), { ...row }, undefined, undefined, 'budget-run', false, new SourceTrace(row, 'budget-run', runBudget(-1), true));
  assert.equal(row.health_status, before.health_status); assert.equal(row.last_checked_at, before.last_checked_at);
  assert.equal(row.snapshot, before.snapshot); assert.equal(row.last_hash, before.last_hash); assert.equal(row.lease_until, null); assert.equal(db.events.size, 0);
});

test('a manual health-only recovery preserves the baseline for the next natural comparison', async () => {
  const db = new MemoryD1(); const url = 'https://example.com/recruit/';
  const row = target({ source_type: 'official', url, normalized_url: url, snapshot: null, snapshot_url: null, snapshot_source_type: null }); db.targets.set(row.id, row);
  let holiday = '124日';
  const restore = setFetchPage(() => new Response(officialHtml('株式会社Aiming', holiday), { headers: { 'content-type': 'text/html' } }));
  try {
    await scheduled(envFor(db)); const before = row.snapshot;
    row.health_status = 'unreachable'; row.health_detail = 'HTTP_503'; row.transient_failure_count = 1; holiday = '130日';
    await checkTarget(envFor(db), { ...row }, undefined, undefined, 'manual', true);
    assert.equal(row.snapshot, before); assert.equal(row.health_status, 'healthy'); assert.equal(db.events.size, 0);
    await scheduled(envFor(db)); assert.equal(db.events.size, 1);
  } finally { restore(); }
});

test('a confirmed HTTP 404 after a temporary 503 alerts immediately despite the same unreachable health class', async () => {
  const db = new MemoryD1(); const row = target({ health_status: 'unreachable', health_detail: 'HTTP_503', transient_failure_count: 1 }); db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response('', { status: 404 }));
  try { await scheduled(envFor(db)); assert.equal(row.health_detail, 'HTTP_404'); assert.equal(db.events.size, 1); }
  finally { restore(); }
});

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

test('scheduled MyNavi checks skip recruitment diffs, preserve legacy snapshots, and silently baseline on recovery', async () => {
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
    assert.equal(db.events.size, 1, 'ordinary recovery is silent');
    assert.ok(![...db.events.values()].some((event) => event.event_type === 'source_health_recovered'));
    assert.ok(![...db.events.values()].some((event) => String(event.event_type).includes('updated')));
    assert.equal(row.snapshot?.includes('年間休日124日'), true, 'MyNavi keeps legacy snapshots untouched and never uses them as a new diff baseline');

    holiday = '年間休日126日';
    await scheduled(envFor(db));
    assert.ok(![...db.events.values()].some((event) => ['job_info_updated', 'other_recruitment_update'].includes(String(event.event_type))));
  } finally { restore(); }
});

test('MyNavi no longer rebuilds or compares the legacy recruitment snapshot', async () => {
  const db = new MemoryD1();
  const row = target({ snapshot_source_type: 'other', snapshot: '{"old":"snapshot"}', last_hash: 'old-hash' });
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.equal(row.snapshot_source_type, 'other');
    assert.equal(row.snapshot, '{"old":"snapshot"}');
    assert.equal(row.last_hash, 'old-hash');
    assert.deepEqual([...db.events.values()], [], 'the entry baseline is silent and legacy snapshot structure is ignored');
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.deepEqual([...db.events.values()], [], 'unchanged entry state stays silent');
  } finally { restore(); }
});

test('health failures notify on entry, stay silent while repeated, and can notify again after recovery', async () => {
  const db = new MemoryD1();
  const row = target();
  db.targets.set(row.id, row);
  let pageName = '(株)エイティング';
  const restore = setFetchPage(() => new Response(mynaviHtml(pageName), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'source_health_issue');

    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'the same active exception is not repeated');

    pageName = '(株)Aiming';
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.equal(db.events.size, 1, 'recovery does not create a notification');

    pageName = '(株)エイティング';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 2, 'a new healthy-to-error transition is notified even if it matches an older event');
  } finally { restore(); }
});

test('a legacy event prevents a duplicate when the target health state is missing', async () => {
  const db = new MemoryD1();
  const row = target({ health_status: null });
  db.targets.set(row.id, row);
  db.events.set('legacy-health-event', { id: 'legacy-health-event', watch_target_id: row.id, event_type: 'source_health_issue', after_excerpt: 'identity_mismatch', detected_at: new Date().toISOString() });
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)エイティング'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'an existing same-state health event remains deduplicated');
    assert.equal(row.health_status, 'identity_mismatch');
  } finally { restore(); }
});

test('MyNavi first open check only establishes a silent Entry baseline', async () => {
  const db = new MemoryD1();
  const row = target({ snapshot: null, last_hash: null, snapshot_url: null, snapshot_source_type: null, health_status: null, detected_company_name: null });
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming', '年間休日124日', '(株)サクセス', '<a href="/entry">エントリー</a>'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'open');
    assert.ok(row.entry_last_checked_at);
    assert.equal(row.entry_url, 'https://job.mynavi.jp/entry');
    assert.equal(db.events.size, 0, 'a deployment baseline does not notify even when already open');
    await scheduled(envFor(db));
    assert.equal(db.events.size, 0, 'open to open is silent');
  } finally { restore(); }
});

test('MyNavi reservation to open notifies once, but changes to recruitment copy do not', async () => {
  const db = new MemoryD1();
  const row = target({ entry_status: 'reservation', entry_status_changed_at: '2026-09-01T00:00:00.000Z', snapshot: null, last_hash: null, health_status: 'healthy' });
  db.targets.set(row.id, row);
  let entryMarkup = '<a href="/reserve">エントリー予約</a>';
  let holiday = '年間休日124日';
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming', holiday, '(株)サクセス', entryMarkup), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(db.events.size, 0, 'reservation to reservation does not notify');
    entryMarkup = '<a href="/entry">エントリーする</a>';
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'open');
    assert.equal(db.events.size, 1);
    const event = [...db.events.values()][0];
    assert.equal(event.event_type, 'mynavi_entry_open');
    assert.equal(event.title, 'エントリー受付が開始されました');
    assert.equal(event.summary, 'マイナビでエントリーできるようになりました。');
    holiday = '年間休日125日';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'open to open and recruitment-copy changes do not notify');
  } finally { restore(); }
});

test('MyNavi closed to open can notify again while open to closed stays silent', async () => {
  const db = new MemoryD1();
  const row = target({ entry_status: 'closed', entry_status_changed_at: '2026-09-01T00:00:00.000Z', snapshot: null, last_hash: null, health_status: 'healthy' });
  db.targets.set(row.id, row);
  let entryMarkup = '<p>エントリー受付終了</p>';
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)Aiming', '年間休日124日', '(株)サクセス', entryMarkup), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'closed');
    assert.equal(db.events.size, 0);
    entryMarkup = '<a href="/entry">エントリーはこちら</a>';
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'open');
    assert.equal(db.events.size, 1);
    entryMarkup = '<p>エントリー受付終了</p>';
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'closed');
    assert.equal(db.events.size, 1, 'open to closed remains silent');
    entryMarkup = '<button>エントリー</button>';
    await scheduled(envFor(db));
    assert.equal(row.entry_status, 'open');
    assert.equal(db.events.size, 2, 'closed to open emits one reopening event');
  } finally { restore(); }
});

test('Mynavi identity mismatch stops Entry detection and leaves its prior state untouched', async () => {
  const db = new MemoryD1();
  const row = target({ entry_status: 'unavailable', entry_status_changed_at: '2026-09-01T00:00:00.000Z' });
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response(mynaviHtml('(株)エイティング', '年間休日125日', '(株)サクセス', '<a href="/entry">エントリー</a>'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'identity_mismatch');
    assert.equal(row.entry_status, 'unavailable');
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'source_health_issue');
    assert.ok(![...db.events.values()].some((event) => event.event_type === 'mynavi_entry_open'));
  } finally { restore(); }
});

test('official sources retain ordinary recruitment-diff notifications', async () => {
  const db = new MemoryD1();
  const url = 'https://example.com/recruit';
  const row = target({ id: 'official-target', source_type: 'official', url, normalized_url: url, snapshot: null, last_hash: null, snapshot_url: null, snapshot_source_type: null, health_status: null, detected_company_name: null });
  db.targets.set(row.id, row);
  let holiday = '124';
  const restore = setFetchPage(() => new Response(officialHtml('株式会社Aiming', holiday), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(db.events.size, 0, 'official first check establishes snapshot baseline');
    holiday = '125';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'job_info_updated');
  } finally { restore(); }
});

test('Aiming HRMOS recovery silently rebuilds its baseline, then reports only a real job-body change once', async () => {
  const db = new MemoryD1();
  const oldSnapshot = '旧形式の有効な求人内容。募集要項と応募資格を含む。';
  const row = target({
    id: 'aiming-hrmos', company_name: '株式会社Aiming', source_type: 'official', url: aimingHrmosUrl, normalized_url: aimingHrmosUrl,
    health_status: 'extraction_failed', health_detail: 'INSUFFICIENT_PUBLIC_CONTENT', detected_company_name: '株式会社Aiming',
    snapshot: oldSnapshot, snapshot_url: aimingHrmosUrl, snapshot_source_type: 'official', last_hash: 'previous-valid-hash',
  });
  db.targets.set(row.id, row);
  let extraDetail = '';
  const restore = setFetchPage((url) => new Response(aimingHrmosHtml('株式会社Aiming', extraDetail), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.equal(row.detected_company_name, '株式会社Aiming');
    assert.equal(JSON.parse(row.snapshot!).adapter, 'hrmos-job-v1');
    assert.match(row.snapshot!, /応募ページ/);
    assert.deepEqual([...db.events.values()], [], 'first valid extraction after failure is a silent baseline, not a recruitment update');

    await scheduled(envFor(db));
    assert.deepEqual([...db.events.values()], [], 'an unchanged job body does not notify');
    extraDetail = '新たにクラウド基盤の改善業務を担当します。';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'job_info_updated');
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'the same content change cannot generate a duplicate');
  } finally { restore(); }
});

test('MIXI official API recovery silently baselines the 2028 job and later details changes notify once', async () => {
  const db = new MemoryD1();
  const oldSnapshot = '募集が見つかりませんでした。条件を変更して再度お試しください。';
  const row = target({
    id: 'mixi-official', company_name: '株式会社MIXI', source_type: 'official', url: mixiListUrl, normalized_url: mixiListUrl,
    health_status: 'extraction_failed', health_detail: 'INSUFFICIENT_PUBLIC_CONTENT', detected_company_name: 'MIXI GROUP',
    snapshot: oldSnapshot, snapshot_url: mixiListUrl, snapshot_source_type: 'official', last_hash: 'empty-page-hash',
  });
  db.targets.set(row.id, row);
  let extraDetail = '';
  const restore = setFetchPage((url) => {
    if (url.includes('/wp-json/wp_query/args/')) return new Response(JSON.stringify(mixiApiPosts()), { headers: { 'content-type': 'application/json; charset=UTF-8' } });
    if (url === mixiJobUrl) return new Response(mixiJobHtml(extraDetail), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url === mixiListUrl) return new Response(mixiListingHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    throw new Error(`Unexpected test request: ${url}`);
  });
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'healthy');
    assert.equal(row.detected_company_name, '株式会社MIXI');
    assert.equal(JSON.parse(row.snapshot!).adapter, 'mixi-wp-json-v1');
    assert.match(row.snapshot!, /2028年/);
    assert.match(row.snapshot!, /mixi-recruit\.snar\.jp\/entry\.aspx/);
    assert.deepEqual([...db.events.values()], [], 'an extraction recovery does not claim a historical opening date or notify');

    await scheduled(envFor(db));
    assert.deepEqual([...db.events.values()], [], 'the same official job post stays silent');
    extraDetail = '追加募集内容: 大規模サービスの信頼性改善も担当します。';
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1);
    assert.equal([...db.events.values()][0].event_type, 'job_info_updated');
    await scheduled(envFor(db));
    assert.equal(db.events.size, 1, 'unchanged API and detail content do not repeat the update event');
  } finally { restore(); }
});

test('invalid MIXI list data and Aiming identity mismatch never replace a previously stored snapshot', async () => {
  const db = new MemoryD1();
  const mixiOldSnapshot = 'MIXI以前に確認できた有効な募集内容';
  const mixiRow = target({
    id: 'mixi-invalid', company_name: '株式会社MIXI', source_type: 'official', url: mixiListUrl, normalized_url: mixiListUrl,
    health_status: 'extraction_failed', health_detail: 'INSUFFICIENT_PUBLIC_CONTENT', snapshot: mixiOldSnapshot,
    snapshot_url: mixiListUrl, snapshot_source_type: 'official', last_hash: 'mixi-old-hash',
  });
  const aimingOldSnapshot = 'Aiming以前に確認できた有効な募集内容';
  const aimingRow = target({
    id: 'aiming-mismatch', company_name: '株式会社Aiming', source_type: 'official', url: aimingHrmosUrl, normalized_url: aimingHrmosUrl,
    health_status: 'extraction_failed', health_detail: 'INSUFFICIENT_PUBLIC_CONTENT', snapshot: aimingOldSnapshot,
    snapshot_url: aimingHrmosUrl, snapshot_source_type: 'official', last_hash: 'aiming-old-hash',
  });
  db.targets.set(mixiRow.id, mixiRow);
  db.targets.set(aimingRow.id, aimingRow);
  const restore = setFetchPage((url) => {
    if (url.includes('/wp-json/wp_query/args/')) return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json; charset=UTF-8' } });
    if (url === mixiListUrl) return new Response(mixiListingHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url === aimingHrmosUrl) return new Response(aimingHrmosHtml('(株)エイティング'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    throw new Error(`Unexpected test request: ${url}`);
  });
  try {
    await scheduled(envFor(db));
    assert.equal(mixiRow.health_status, 'extraction_failed');
    assert.equal(mixiRow.snapshot, mixiOldSnapshot);
    assert.equal(mixiRow.last_hash, 'mixi-old-hash');
    assert.equal(aimingRow.health_status, 'identity_mismatch');
    assert.equal(aimingRow.detected_company_name, '(株)エイティング');
    assert.equal(aimingRow.snapshot, aimingOldSnapshot);
    assert.equal(aimingRow.last_hash, 'aiming-old-hash');
    assert.ok(![...db.events.values()].some((event) => ['job_info_updated', 'other_recruitment_update'].includes(String(event.event_type))));
  } finally { restore(); }
});

test('an HTTP failure for an official recruitment page preserves its previous snapshot and success time', async () => {
  const db = new MemoryD1();
  const oldSnapshot = '以前の有効なAiming求人スナップショット';
  const oldSuccessAt = '2026-09-28T00:18:11.739Z';
  const row = target({
    id: 'aiming-unreachable', company_name: '株式会社Aiming', source_type: 'official', url: aimingHrmosUrl, normalized_url: aimingHrmosUrl,
    health_status: 'extraction_failed', health_detail: 'INSUFFICIENT_PUBLIC_CONTENT', snapshot: oldSnapshot,
    snapshot_url: aimingHrmosUrl, snapshot_source_type: 'official', last_hash: 'old-hash', last_success_at: oldSuccessAt,
  });
  db.targets.set(row.id, row);
  const restore = setFetchPage(() => new Response('temporarily unavailable', { status: 503, headers: { 'content-type': 'text/plain' } }));
  try {
    await scheduled(envFor(db));
    assert.equal(row.health_status, 'unreachable');
    assert.equal(row.snapshot, oldSnapshot);
    assert.equal(row.last_hash, 'old-hash');
    assert.equal(row.last_success_at, oldSuccessAt);
    assert.ok(![...db.events.values()].some((event) => ['job_info_updated', 'other_recruitment_update'].includes(String(event.event_type))));
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
