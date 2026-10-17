import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage } from '../src/monitor';
import { CheckError, SourceTrace, runBudget } from '../src/reliability';

const page = 'https://example.com/recruit';
const policy = 'https://example.com/robots.txt';
const allow = () => new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
const html = () => new Response('<main>Recruitment</main>', { headers: { 'content-type': 'text/html' } });
type Call = { url: string; redirect: RequestRedirect | undefined };
async function mockFetch(route: (url: string) => Response, run: (calls: Call[], logs: Array<Record<string, unknown>>) => Promise<void>, dnsAddress = '198.51.100.10') {
  const original = globalThis.fetch; const info = console.info;
  const calls: Call[] = []; const logs: Array<Record<string, unknown>> = [];
  console.info = (entry: Record<string, unknown>) => { logs.push(entry); };
  globalThis.fetch = (async (input, init) => {
    const url = String(input); calls.push({ url, redirect: init?.redirect });
    if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Answer: [{ data: url.includes('redirect.example') ? dnsAddress : '198.51.100.10' }] });
    return route(url);
  }) as typeof fetch;
  try { await run(calls, logs); } finally { globalThis.fetch = original; console.info = info; }
}
const rejectPolicy = (promise: Promise<unknown>, status: number | null) => assert.rejects(promise, (error: unknown) => error instanceof CheckError && error.code === 'ROBOTS_POLICY_UNVERIFIABLE' && error.httpStatus === status);

test('valid 200 text/plain policy permits the existing recruitment request', async () => {
  await mockFetch((url) => url === policy ? allow() : html(), async (calls, logs) => {
    assert.equal((await fetchPage(page)).status, 200);
    assert.ok(calls.some((call) => call.url === page)); assert.ok(logs.some((row) => row.decision === 'verified'));
  });
});

test('robots follows a 302 to valid policy without automatic redirects', async () => {
  await mockFetch((url) => url === policy ? Response.redirect('https://example.com/policy.txt', 302) : url.endsWith('policy.txt') ? allow() : html(), async (calls) => {
    await fetchPage(page);
    assert.equal(calls.filter((call) => !call.url.includes('dns-query')).length, 3);
    assert.ok(calls.filter((call) => !call.url.includes('dns-query')).every((call) => call.redirect === 'manual'));
  });
});

test('five consecutive redirects are followed, including cross-authority rules for the original host', async () => {
  await mockFetch((url) => {
    if (url === policy) return Response.redirect('https://redirect.example/one');
    const step = ['/one', '/two', '/three', '/four', '/five'];
    const index = step.indexOf(new URL(url).pathname);
    return index >= 0 ? index === 4 ? allow() : Response.redirect(`https://redirect.example${step[index + 1]}`) : html();
  }, async (calls) => {
    assert.equal((await fetchPage(page)).status, 200);
    assert.equal(calls.filter((call) => call.url.startsWith('https://redirect.example/')).length, 5);
  });
});

test('redirected Disallow is applied to the original origin, not the policy CDN', async () => {
  await mockFetch((url) => url === policy ? Response.redirect('https://redirect.example/rules') : new Response('User-agent: *\nDisallow: /recruit'), async (calls) => {
    await assert.rejects(fetchPage(page), /ROBOTS_DISALLOWED/);
    assert.ok(!calls.some((call) => call.url === page));
  });
});

test('K-Line style 302 -> 200 HTML soft-404 is unverified, never permission to fetch', async () => {
  await mockFetch((url) => url === policy ? Response.redirect('https://example.com/404.html') : new Response('<!doctype html><html><head><title>404エラーページ</title></head></html>', { headers: { 'content-type': 'text/html' } }), async (calls, logs) => {
    await rejectPolicy(fetchPage(page), 200);
    assert.ok(logs.some((row) => row.decision === 'html-soft-404'));
    assert.ok(!calls.some((call) => call.url === page));
  });
});

for (const status of [404, 410]) test(`actual HTTP ${status} robots is unavailable, not a parsed HTML policy`, async () => {
  await mockFetch((url) => url === policy ? new Response('<html>Not found</html>', { status }) : html(), async () => { assert.equal((await fetchPage(page)).status, 200); });
});

test('a redirect that actually ends in HTTP 404 may proceed', async () => {
  await mockFetch((url) => url === policy ? Response.redirect('https://example.com/gone') : url.endsWith('/gone') ? new Response('', { status: 404 }) : html(), async () => { assert.equal((await fetchPage(page)).status, 200); });
});

for (const status of [401, 403, 500, 503]) test(`robots HTTP ${status} does not grant access`, async () => {
  await mockFetch(() => new Response('', { status, headers: { 'retry-after': '60' } }), async (calls) => {
    await assert.rejects(fetchPage(page), (error: unknown) => error instanceof CheckError && error.httpStatus === status);
    assert.ok(!calls.some((call) => call.url === page));
  });
});

test('robots redirect loop stops without a page request', async () => {
  await mockFetch((url) => Response.redirect(url === policy ? 'https://example.com/again' : policy), async (calls, logs) => {
    await rejectPolicy(fetchPage(page), 302);
    assert.ok(logs.some((row) => row.decision === 'redirect-loop'));
    assert.equal(calls.filter((call) => !call.url.includes('dns-query')).length, 2);
  });
});

test('a sixth redirect does not cause an unbounded fetch or allow fallback', async () => {
  await mockFetch((url) => Response.redirect(`https://example.com/${url === policy ? 1 : Number(new URL(url).pathname.slice(1)) + 1}`), async (calls, logs) => {
    await rejectPolicy(fetchPage(page), 302);
    assert.equal(calls.filter((call) => !call.url.includes('dns-query')).length, 6);
    assert.ok(logs.some((row) => row.decision === 'redirect-limit'));
  });
});

for (const location of ['http://127.0.0.1/policy', 'https://user:secret@redirect.example/rules', 'javascript:alert(1)']) test(`unsafe robots redirect is rejected (${location.split(':')[0]})`, async () => {
  await mockFetch(() => new Response('', { status: 302, headers: { location } }), async (calls) => {
    await rejectPolicy(fetchPage(page), 302);
    assert.equal(calls.filter((call) => !call.url.includes('dns-query')).length, 1);
  });
});

test('a public-looking redirect hostname resolving to a private address is not fetched', async () => {
  await mockFetch(() => Response.redirect('https://redirect.example/rules'), async (calls) => {
    await assert.rejects(fetchPage(page), /URL_PRIVATE_HOST/);
    assert.ok(!calls.some((call) => call.url === 'https://redirect.example/rules'));
  }, '10.1.2.3');
});

test('explicit Disallow continues to block the recruitment path', async () => {
  await mockFetch(() => new Response('User-agent: *\nDisallow: /recruit'), async (calls) => {
    await assert.rejects(fetchPage(page), /ROBOTS_DISALLOWED/); assert.ok(!calls.some((call) => call.url === page));
  });
});

test('parseable plain-text rules survive malformed lines, without erasing Disallow', async () => {
  await mockFetch(() => new Response('User-agent: *\ninvalid line\nDisallow: /recruit\nother record'), async () => { await assert.rejects(fetchPage(page), /ROBOTS_DISALLOWED/); });
});

for (const content of ['', '# No restrictions\n', 'Sitemap: https://example.com/sitemap.xml']) test('empty/comment/sitemap-only policies remain usable', async () => {
  await mockFetch((url) => url === policy ? new Response(content) : html(), async () => { assert.equal((await fetchPage(page)).status, 200); });
});

for (const content of ['temporarily unavailable', '{"error":"service unavailable"}', '<html><body>Login required</body></html>']) test('unrecognized or HTML response never becomes an empty allow policy', async () => {
  await mockFetch(() => new Response(content), async (calls) => { await rejectPolicy(fetchPage(page), 200); assert.ok(!calls.some((call) => call.url === page)); });
});

test('a filename alone is not evidence of soft-404: a real policy at /404.html still applies', async () => {
  await mockFetch((url) => url === policy ? Response.redirect('https://example.com/404.html') : new Response('User-agent: *\nDisallow: /recruit'), async () => { await assert.rejects(fetchPage(page), /ROBOTS_DISALLOWED/); });
});

test('robots redirect chains retain the existing execution and retry budgets', async () => {
  await mockFetch(() => allow(), async (calls) => {
    const trace = new SourceTrace({ id: 'source', company_id: 'company', source_type: 'official' }, 'run', runBudget(-1));
    await assert.rejects(fetchPage(page, trace), /CHECK_BUDGET_EXHAUSTED/); assert.equal(calls.length, 0);
  });
});
