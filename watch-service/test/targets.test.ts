import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { scheduled } from '../src/index';
import type { TargetRow } from '../src/types';

type StoredTarget = TargetRow & { lease_until: string | null };

class MemoryD1 {
  targets = new Map<string, StoredTarget>();
  events = new Map<string, Record<string, unknown>>();
  rowsRead = 0;

  prepare(sql: string) {
    const query = sql.replace(/\s+/g, ' ').trim();
    let values: unknown[] = [];
    const db = this;
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async first<T>() {
        if (query.startsWith('SELECT expires_at FROM sessions')) return { expires_at: new Date(Date.now() + 60_000).toISOString() } as T;
        if (query.includes('WHERE company_id=? AND normalized_url=?')) {
          return [...db.targets.values()].find((row) => row.company_id === values[0] && row.normalized_url === values[1]) as T | undefined || null;
        }
        if (query.includes('WHERE id=?')) return db.targets.get(String(values[0])) as T | undefined || null;
        throw new Error(`Unsupported SELECT: ${query}`);
      },
      async run() {
        if (query.startsWith('INSERT OR IGNORE INTO watch_targets')) {
          const [id, company_id, company_name, source_type, label, url, normalized_url, created_at, updated_at] = values as [string, string, string, StoredTarget['source_type'], string, string, string, string, string];
          const exists = [...db.targets.values()].some((row) => row.company_id === company_id && row.normalized_url === normalized_url);
          if (exists) return { meta: { changes: 0 } };
          db.targets.set(id, { id, company_id, company_name, source_type, label, url, normalized_url, enabled: 1, created_at, updated_at, last_checked_at: null, last_success_at: null, status: 'checking', last_http_status: null, last_hash: null, last_error: null, snapshot: null, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith('INSERT OR IGNORE INTO watch_events')) {
          const [id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read, content_hash] = values as unknown[];
          const duplicate = [...db.events.values()].some((event) => event.watch_target_id === watch_target_id && event.event_type === event_type && event.content_hash === content_hash);
          if (duplicate) return { meta: { changes: 0 } };
          db.events.set(String(id), { id, company_id, company_name, watch_target_id, event_type, title, summary, before_excerpt, after_excerpt, detected_at, source_url, source_type, read, content_hash });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='checking',last_error=NULL,last_http_status=NULL,lease_until=?")) {
          const [lease, updatedAt, id, now] = values as [string, string, string, string];
          const row = db.targets.get(id);
          if (!row || !row.enabled || (row.lease_until && row.lease_until >= now)) return { meta: { changes: 0 } };
          Object.assign(row, { status: 'checking', last_error: null, lease_until: lease, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='active'")) {
          const [last_checked_at, last_success_at, last_http_status, last_hash, snapshot, updated_at, id, lease] = values as [string, string, number, string, string, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease || !row.enabled) return { meta: { changes: 0 } };
          Object.assign(row, { status: 'active', last_checked_at, last_success_at, last_http_status, last_hash, snapshot, updated_at, last_error: null, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET status='error'")) {
          const [last_checked_at, last_http_status, last_error, updated_at, id, lease] = values as [string, number | null, string, string, string, string];
          const row = db.targets.get(id);
          if (!row || row.lease_until !== lease || !row.enabled) return { meta: { changes: 0 } };
          Object.assign(row, { status: 'error', last_checked_at, last_http_status, last_error, updated_at, lease_until: null });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE watch_targets SET enabled=?,status=?,last_error=NULL,last_http_status=NULL,lease_until=NULL,label=?,url=?,normalized_url=?,source_type=?,snapshot=CASE")) {
          const [enabled, status, label, url, normalized_url, source_type, resetSnapshot, resetHash, updated_at, id] = values as [number, StoredTarget['status'], string, string, string, StoredTarget['source_type'], number, number, string, string];
          const row = db.targets.get(id);
          if (!row) return { meta: { changes: 0 } };
          Object.assign(row, { enabled, status, label, url, normalized_url, source_type, updated_at, last_error: null, last_http_status: null, lease_until: null, snapshot: resetSnapshot ? null : row.snapshot, last_hash: resetHash ? null : row.last_hash });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unsupported UPDATE: ${query}`);
      },
      async all<T>() {
        db.rowsRead += 1;
        if (query.startsWith("SELECT * FROM watch_targets WHERE enabled=1")) return { results: [...db.targets.values()].filter((row) => row.enabled && row.status !== 'paused').sort((a, b) => (a.last_checked_at || '').localeCompare(b.last_checked_at || '')).slice(0, 12) as T[] };
        return { results: [] as T[] };
      },
    };
  }
}

async function addTarget(db: MemoryD1, pending: Promise<unknown>[], body: Record<string, string>) {
  const env = { DB: db, WATCH_ACCESS_CODE: 'unused-in-session-auth', ALLOWED_ORIGIN: 'https://careerflow.example' } as unknown as import('../src/types').Env;
  const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext;
  const request = new Request('https://careerflow-watch.example.workers.dev/api/targets', {
    method: 'POST',
    headers: { authorization: 'Bearer test-session', origin: env.ALLOWED_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, env, ctx);
}

test('first Mynavi add and duplicate retry keep the same target and deterministic robots result', async () => {
  const db = new MemoryD1();
  const pending: Promise<unknown>[] = [];
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; userAgent: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.10' }] }), { headers: { 'content-type': 'application/json' } });
    requests.push({ url, userAgent: new Headers(init?.headers).get('user-agent') || '' });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: CareerFlowWatch\nDisallow: /28/pc/corpinfo/displayPrevEmployment/', { headers: { 'content-type': 'text/plain' } });
    throw new Error('A disallowed target must not fetch the page');
  }) as typeof fetch;
  const rawUrl = 'https://job.mynavi.jp/28/pc/corpinfo/displayPrevEmployment/index/?corpId=292189&recruitingCourseId=27052359';
  const body = { companyId: 'company-test', companyName: 'テスト企業', sourceType: 'mynavi', url: rawUrl };
  try {
    const firstResponse = await addTarget(db, pending, body);
    const first = await firstResponse.json() as { id: string; duplicate: boolean; queued: boolean; status: string };
    await Promise.all(pending.splice(0));
    const firstTarget = [...db.targets.values()][0];
    assert.equal(firstResponse.status, 201);
    assert.equal(first.duplicate, false);
    assert.equal(first.queued, true);
    assert.equal(firstTarget.url, rawUrl);
    assert.equal(firstTarget.normalized_url, rawUrl);
    assert.equal(firstTarget.status, 'error');
    assert.equal(firstTarget.last_error, 'ROBOTS_DISALLOWED');

    const secondResponse = await addTarget(db, pending, body);
    const second = await secondResponse.json() as { id: string; duplicate: boolean; queued: boolean; status: string };
    await Promise.all(pending.splice(0));
    assert.equal(secondResponse.status, 200);
    assert.equal(second.id, first.id);
    assert.equal(second.duplicate, true);
    assert.equal(second.queued, true);
    assert.equal(db.targets.size, 1);
    assert.equal([...db.targets.values()][0].status, 'error');
    assert.equal([...db.targets.values()][0].last_error, 'ROBOTS_DISALLOWED');
    assert.deepEqual(requests.map((entry) => entry.url), [
      'https://job.mynavi.jp/robots.txt',
      'https://job.mynavi.jp/robots.txt',
    ]);
    assert.ok(requests.every((entry) => entry.userAgent.startsWith('CareerFlowWatch/1.0')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('first official recruitment page add resolves to active without a second request', async () => {
  const db = new MemoryD1();
  const pending: Promise<unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.11' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return new Response('<main><h1>2027年度 新卒採用 募集要項</h1><p>新卒採用の募集情報です。応募資格、募集職種、初任給、勤務地についてご案内します。</p></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  try {
    const response = await addTarget(db, pending, { companyId: 'company-official', companyName: '公式採用企業', sourceType: 'official', url: 'https://recruit.example.com/new-graduate' });
    const created = await response.json() as { id: string; duplicate: boolean; queued: boolean; status: string };
    await Promise.all(pending);
    const target = db.targets.get(created.id)!;
    assert.equal(response.status, 201);
    assert.equal(created.duplicate, false);
    assert.equal(created.queued, true);
    assert.equal(target.status, 'active');
    assert.equal(target.last_http_status, 200);
    assert.ok(target.last_success_at);
    assert.ok(target.last_hash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled Mynavi checks baseline silently, ignore shared reservation UI, and notify for one real company update', async () => {
  const db = new MemoryD1();
  const now = new Date().toISOString();
  for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
    const id = `target-${suffix}`;
    db.targets.set(id, {
      id, company_id: `company-${suffix}`, company_name: `企業${suffix}`, source_type: 'mynavi', label: '',
      url: `https://job.mynavi.jp/recruit/${suffix}`, normalized_url: `https://job.mynavi.jp/recruit/${suffix}`,
      enabled: 1, created_at: now, updated_at: now, last_checked_at: null, last_success_at: null,
      status: 'active', last_http_status: null, last_hash: null, last_error: null, snapshot: null, lease_until: null,
    });
  }
  const env = { DB: db } as unknown as import('../src/types').Env;
  const originalFetch = globalThis.fetch;
  let reservation = '';
  let changedCompany: string | null = null;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.12' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    const suffix = new URL(url).pathname.split('/').pop()!;
    const holiday = changedCompany === suffix ? '年間休日125日' : '年間休日124日';
    const page = `<main id="mainContents"><h1>企業${suffix} 採用データ</h1><p>${reservation}</p><section><h2>募集要項</h2><p>${holiday}</p><p>募集職種はシステムエンジニアです。</p></section></main>`;
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  try {
    await scheduled(env);
    assert.equal(db.events.size, 0, 'initial check only establishes the baseline');
    assert.ok([...db.targets.values()].every((target) => target.snapshot?.startsWith('{')));

    reservation = '3/1エントリー予約リストに追加した企業へのエントリーを行いました。';
    await scheduled(env);
    assert.equal(db.events.size, 0, 'personalized reservation UI does not create company events');

    changedCompany = 'a';
    await scheduled(env);
    assert.equal(db.events.size, 1);
    const event = [...db.events.values()][0];
    assert.equal(event.company_id, 'company-a');
    assert.equal(event.event_type, 'job_info_updated');
    assert.match(String(event.summary), /募集要項/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled batch suppresses identical fallback changes shared by five companies in the same run', async () => {
  const db = new MemoryD1();
  const now = new Date().toISOString();
  for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
    const id = `generic-${suffix}`;
    db.targets.set(id, {
      id, company_id: `generic-company-${suffix}`, company_name: `企業${suffix}`, source_type: 'other', label: '',
      url: `https://careers.example.com/recruit/${suffix}`, normalized_url: `https://careers.example.com/recruit/${suffix}`,
      enabled: 1, created_at: now, updated_at: now, last_checked_at: null, last_success_at: null,
      status: 'active', last_http_status: null, last_hash: null, last_error: null, snapshot: null, lease_until: null,
    });
  }
  const env = { DB: db } as unknown as import('../src/types').Env;
  const originalFetch = globalThis.fetch;
  let includeSharedCopy = false;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.13' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    const shared = includeSharedCopy ? '<p>応募手続きは共通のオンライン受付を利用します。</p>' : '';
    return new Response(`<main><p>2028年度の新卒採用情報を公開しています。</p><p>募集職種と選考の流れをご案内しています。</p>${shared}</main>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  try {
    await scheduled(env);
    assert.equal(db.events.size, 0);
    includeSharedCopy = true;
    await scheduled(env);
    assert.equal(db.events.size, 0, 'same-host matching fallback diffs are suppressed within the run');
    assert.ok([...db.targets.values()].every((target) => target.status === 'active'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('changing a monitored URL clears the previous snapshot and silently establishes a baseline', async () => {
  const db = new MemoryD1();
  const id = 'target-url-change';
  const now = new Date().toISOString();
  db.targets.set(id, {
    id, company_id: 'company-url-change', company_name: 'URL変更企業', source_type: 'official', label: '',
    url: 'https://old.example.com/recruit', normalized_url: 'https://old.example.com/recruit',
    enabled: 1, created_at: now, updated_at: now, last_checked_at: now, last_success_at: now,
    status: 'active', last_http_status: 200, last_hash: 'old-page-hash', last_error: null,
    snapshot: JSON.stringify({ version: 3, adapter: 'official-main-v2', selector: 'company-sections', sections: [{ label: '募集要項', selector: 'company-section-container', scope: 'company', lines: ['古いページの全く異なる内容'], meaningfulLines: ['古いページの全く異なる内容'] }] }), lease_until: null,
  });
  const env = { DB: db, WATCH_ACCESS_CODE: 'unused-in-session-auth', ALLOWED_ORIGIN: 'https://careerflow.example' } as unknown as import('../src/types').Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.14' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return new Response('<main><section><h2>募集要項</h2><p>現在の募集要項を公開しています。</p><p>初任給や勤務地をご案内します。</p></section></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  try {
    const response = await worker.fetch(new Request(`https://careerflow-watch.example.workers.dev/api/targets/${id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer test-session', origin: env.ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://new.example.com/recruit' }),
    }), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(db.targets.get(id)?.snapshot, null, 'URL change clears old snapshot before the new check');
    await Promise.all(pending);
    const updated = db.targets.get(id)!;
    assert.equal(updated.status, 'active');
    assert.ok(updated.snapshot?.startsWith('{'));
    assert.notEqual(updated.last_hash, 'old-page-hash');
    assert.equal(db.events.size, 0, 'new URL is a new baseline, not a company update');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
