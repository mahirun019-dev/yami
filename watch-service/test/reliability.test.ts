import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckError, SourceTrace, checkError, requestText, runBudget, MAX_REQUEST_ATTEMPTS } from '../src/reliability';
import { fetchPage, fetchMixiRecruitmentPosts } from '../src/monitor';

const traceFor = (budget = runBudget()) => new SourceTrace({ id: 'source-id', company_id: 'company-id', source_type: 'official' }, 'run-id', budget, true);

test('request timeout and attempt count are bounded even if fetch ignores abort', async () => {
  const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return new Promise(() => {}); }) as typeof fetch;
  try {
    const started = Date.now(); const trace = traceFor();
    await assert.rejects(requestText('https://example.com/', {}, trace, 'page', 5), (error: unknown) => error instanceof CheckError && error.code === 'FETCH_TIMEOUT');
    assert.equal(attempts, MAX_REQUEST_ATTEMPTS); assert.equal(trace.retries, 1); assert.ok(Date.now() - started < 1_000);
  } finally { globalThis.fetch = original; }
});

test('global retry allowance caps amplification across multiple failing sources', async () => {
  const original = globalThis.fetch; const budget = runBudget(); let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return new Response('', { status: 503 }); }) as typeof fetch;
  try {
    await Promise.all(Array.from({ length: 8 }, async () => { await assert.rejects(requestText('https://example.com/', {}, traceFor(budget), 'page'), /HTTP_503/); }));
    assert.equal(attempts, 11); assert.equal(budget.requests, 11); assert.equal(budget.retries, 3);
  } finally { globalThis.fetch = original; }
});

test('429 respects short Retry-After and does not violate a long Retry-After', async () => {
  const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); }) as typeof fetch;
  try {
    await assert.rejects(requestText('https://example.com/', {}, traceFor(), 'page'), /HTTP_429/); assert.equal(attempts, 1);
    globalThis.fetch = (async () => { attempts++; return attempts === 2 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : new Response('ok'); }) as typeof fetch;
    assert.equal((await requestText('https://example.com/', {}, traceFor(), 'page')).text, 'ok'); assert.equal(attempts, 3);
  } finally { globalThis.fetch = original; }
});

test('spent execution budget neither requests nor retries', async () => {
  const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = (async () => { attempts++; return new Response(''); }) as typeof fetch;
  try { await assert.rejects(requestText('https://example.com/', {}, traceFor(runBudget(-1)), 'page'), /CHECK_BUDGET_EXHAUSTED/); assert.equal(attempts, 0); }
  finally { globalThis.fetch = original; }
});

test('a deadline-limited request is an incomplete check, not a website timeout or retryable source fault', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Promise(() => {})) as typeof fetch;
  const trace = traceFor(runBudget(150));
  try {
    await assert.rejects(requestText('https://example.com/', {}, trace, 'page', 1_000), (error: unknown) => error instanceof CheckError && error.code === 'CHECK_BUDGET_EXHAUSTED' && !error.transient);
    assert.equal(trace.requests, 1); assert.equal(trace.retries, 0);
  } finally { globalThis.fetch = original; }
});

test('response body reads share the request timeout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch;
  try { await assert.rejects(requestText('https://example.com/', {}, traceFor(runBudget(1_000, 0)), 'page', 5), /FETCH_TIMEOUT/); }
  finally { globalThis.fetch = original; }
});

test('oversized response cannot create an unbounded HTML buffer', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('x'.repeat(1_500_001))) as typeof fetch;
  try { await assert.rejects(requestText('https://example.com/', {}, traceFor(), 'page'), /RESPONSE_TOO_LARGE/); }
  finally { globalThis.fetch = original; }
});

test('native error messages and credentials never enter diagnostic logs', async () => {
  const original = globalThis.fetch; const originalInfo = console.info; const logs: unknown[] = [];
  console.info = (...args: unknown[]) => { logs.push(...args); };
  globalThis.fetch = (async () => { throw new TypeError('fetch failed Authorization: Bearer SECRET Cookie=PRIVATE name@example.com'); }) as typeof fetch;
  try {
    await assert.rejects(requestText('https://example.com/?token=SECRET', { headers: { authorization: 'Bearer SECRET', cookie: 'PRIVATE' } }, traceFor(runBudget(1_000, 0)), 'page'), /FETCH_CONNECTION_FAILED/);
    const serialized = JSON.stringify(logs);
    assert.doesNotMatch(serialized, /SECRET|PRIVATE|Authorization|Cookie|example\.com|name@/);
    assert.match(serialized, /source-id/); assert.match(serialized, /FETCH_CONNECTION_FAILED/);
    assert.equal(checkError(new Error('sensitive upstream text')).code, 'CHECK_FAILED');
  } finally { globalThis.fetch = original; console.info = originalInfo; }
});

test('same-origin DNS and robots requests are shared but robots permissions remain URL-specific', async () => {
  const original = globalThis.fetch; let dns = 0; let robots = 0; let pages = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('dns-query')) { dns++; return Response.json({ Answer: [{ data: '198.51.100.10' }] }); }
    if (url.endsWith('/robots.txt')) { robots++; return new Response('User-agent: *\nDisallow: /private'); }
    pages++; return new Response('<main>recruitment</main>', { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  try {
    const budget = runBudget();
    await Promise.all([fetchPage('https://example.com/one', traceFor(budget)), fetchPage('https://example.com/two', traceFor(budget))]);
    await assert.rejects(fetchPage('https://example.com/private', traceFor(budget)), /ROBOTS_DISALLOWED/);
    assert.equal(dns, 1); assert.equal(robots, 1); assert.equal(pages, 2);
  } finally { globalThis.fetch = original; }
});

test('MIXI API uses the shared safe request layer and keeps actual HTTP failure', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('dns-query')) return Response.json({ Answer: [{ data: '198.51.100.10' }] });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    return new Response('', { status: 503, headers: { 'retry-after': '30' } });
  }) as typeof fetch;
  try { await assert.rejects(fetchMixiRecruitmentPosts('https://mixigroup-recruit.mixi.co.jp/jobs/', traceFor()), (error: unknown) => error instanceof CheckError && error.httpStatus === 503 && error.transient); }
  finally { globalThis.fetch = original; }
});
