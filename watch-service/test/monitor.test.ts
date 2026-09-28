import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, compareSnapshots, detectMeaningfulChange, extractMeaningfulText, fetchPage, findPlatformSharedChanges, hasCompatibleSnapshot, inspectRecruitmentContent, normalizeUrl, robotsDecision, serializeSnapshot } from '../src/monitor';

const mynaviUrl = 'https://job.mynavi.jp/28/pc/corpinfo/displayPrevEmployment/index/?corpId=292189&recruitingCourseId=27052359';

function mynaviPage(options: { holiday?: string; briefingDate?: string; header?: string; banner?: string; login?: string; recommendation?: string; reservation?: string; updated?: string } = {}) {
  return `<!doctype html><html><body>
    <header><p>${options.header || 'マイナビ 共通ヘッダー'}</p></header>
    <div class="global-banner"><p>${options.banner || '共通キャンペーンのお知らせ'}</p></div>
    <main id="mainContents">
      <h1>テスト企業 前年度採用データ</h1>
      <p>${options.login || 'ログインしてマイページをご利用ください'}</p>
      <p>${options.reservation || ''}</p>
      <section class="recruit-section"><h2>募集要項</h2><dl><dt>年間休日</dt><dd>${options.holiday || '124'}日</dd><dt>募集職種</dt><dd>システムエンジニア</dd></dl></section>
      <section class="briefing-section"><h2>説明会・セミナー</h2><p>開催日：${options.briefingDate || '10/20'}</p></section>
      <section class="recommendations"><h2>おすすめ企業</h2><p>${options.recommendation || 'おすすめ企業A'}</p></section>
      <p>最終更新日：${options.updated || '2026/2/4'}</p>
    </main>
  </body></html>`;
}

function analyzeMynavi(options: Parameters<typeof mynaviPage>[0] = {}) {
  return inspectRecruitmentContent(mynaviPage(options), 'mynavi', mynaviUrl);
}

test('normalizes public URLs and strips tracking', () => assert.equal(normalizeUrl(' https://EXAMPLE.com/recruit/?utm_source=x#top '), 'https://example.com/recruit/'));
test('keeps Mynavi recruitment query parameters stable through normalization', () => {
  const input = 'https://job.mynavi.jp/28/pc/corpinfo/displayPrevEmployment/index/?corpId=292189&recruitingCourseId=27052359';
  assert.equal(normalizeUrl(input), input);
});
test('rejects unsafe URLs', () => { for (const url of ['javascript:alert(1)', 'http://127.0.0.1/x', 'https://user:pass@example.com']) assert.throws(() => normalizeUrl(url)); });
test('distinguishes explicit robots denial from an unverifiable URL', () => {
  const robotsUrl = 'https://example.com/robots.txt';
  assert.equal(robotsDecision(robotsUrl, 'User-agent: *\nDisallow: /recruit', 'https://example.com/recruit'), false);
  assert.equal(robotsDecision(robotsUrl, 'User-agent: *\nDisallow: /*?', 'https://example.com/recruit?corpId=123'), false);
  assert.equal(robotsDecision(robotsUrl, 'User-agent: *\nDisallow: /*?', 'https://example.com/recruit'), true);
  assert.equal(robotsDecision(robotsUrl, 'User-agent: *\nAllow: /', 'https://example.com/recruit'), true);
  assert.equal(robotsDecision(robotsUrl, 'User-agent: *\nDisallow: /', 'https://other.example/recruit'), undefined);
});
test('uses the crawler product token to select its robots group before wildcard rules', () => {
  const robotsUrl = 'https://example.com/robots.txt';
  const contents = 'User-agent: CareerFlowWatch\nAllow: /\nUser-agent: *\nDisallow: /';
  assert.equal(robotsDecision(robotsUrl, contents, 'https://example.com/recruit'), true);
});
test('uses the same crawler identity for robots.txt and page requests', async () => {
  const originalFetch = globalThis.fetch;
  const userAgents: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '203.0.113.10' }] }), { headers: { 'content-type': 'application/json' } });
    userAgents.push(new Headers(init?.headers).get('user-agent') || '');
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return new Response('<main><h1>新卒採用情報</h1></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  try {
    await fetchPage('https://example.com/recruit');
    assert.equal(userAgents.length, 2);
    assert.equal(userAgents[0], userAgents[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('does not turn a transient robots response failure into permission to crawl', async () => {
  const originalFetch = globalThis.fetch;
  let robotsAttempt = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Answer: [{ data: '198.51.100.10' }] }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/robots.txt')) {
      robotsAttempt += 1;
      return robotsAttempt === 1
        ? new Response('User-agent: CareerFlowWatch\nDisallow: /28/pc/corpinfo/displayPrevEmployment/', { headers: { 'content-type': 'text/plain' } })
        : new Response('unavailable', { status: 503 });
    }
    throw new Error('Page fetch must not run when robots could not be verified');
  }) as typeof fetch;
  const url = 'https://job.mynavi.jp/28/pc/corpinfo/displayPrevEmployment/index/?corpId=292189&recruitingCourseId=27052359';
  try {
    await assert.rejects(fetchPage(url), /ROBOTS_DISALLOWED/);
    await assert.rejects(fetchPage(url), /ROBOTS_POLICY_UNVERIFIABLE/);
    assert.equal(robotsAttempt, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('ignores scripts, navigation, analytics and generated timestamps', () => {
  const before = extractMeaningfulText('<nav>エントリー開始</nav><main><p>新卒採用情報</p><p>最終更新: 2026-01-01</p><script>random-id</script></main>', 'official');
  const after = extractMeaningfulText('<nav>説明会予約開始</nav><main><p>新卒採用情報</p><p>最終更新: 2026-02-02</p><script>other-id</script></main>', 'official');
  assert.equal(detectMeaningfulChange(before, after), null);
});
test('detects relevant added lines', () => assert.ok(detectMeaningfulChange('2028年卒 新卒採用\nエントリー受付前', '2028年卒 新卒採用\nエントリー受付中')));
test('classifies at least five recruitment categories', () => {
  assert.equal(classifyChange(['エントリー受付開始']), 'entry_open');
  assert.equal(classifyChange(['説明会の予約開始']), 'briefing_open');
  assert.equal(classifyChange(['インターン募集開始']), 'internship_open');
  assert.equal(classifyChange(['ES締切日を変更']), 'deadline_changed');
  assert.equal(classifyChange(['Webテスト選考フロー']), 'selection_updated');
  assert.equal(classifyChange(['募集要項 初任給']), 'job_info_updated');
  assert.equal(classifyChange(['募集終了']), 'recruitment_closed');
});
test('accepts a concise public recruitment-status page as a valid baseline', () => {
  const result = inspectRecruitmentContent('<main><h1>2027年度 新卒採用</h1><p>現在、募集を終了しております。</p></main>', 'official');
  assert.equal(result.valid, true);
  assert.match(result.highConfidenceLines.join(' '), /募集を終了/);
});

test('TEST 1: the Mynavi reservation action is ignored across five company pages and shared fallback diffs are grouped per run', () => {
  const before = analyzeMynavi();
  const after = analyzeMynavi({ reservation: '3/1エントリー予約リストに追加した企業へのエントリーを行いました。' });
  assert.match(JSON.stringify(after.ignored), /personalized-or-session-ui/);
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);

  const candidates = ['a', 'b', 'c', 'd', 'e'].map((companyId) => ({
    targetId: `target-${companyId}`, companyId, host: 'job.mynavi.jp', selector: 'main',
    sectionKey: 'fallback:採用関連ページ', scope: 'fallback' as const,
    text: '+3/1エントリー予約リストに追加した企業へのエントリーを行いました。', runId: 'run-1',
  }));
  assert.deepEqual([...findPlatformSharedChanges(candidates)].sort(), candidates.map((item) => item.targetId).sort());
  assert.equal(findPlatformSharedChanges(candidates.map((item) => ({ ...item, runId: 'run-2' }))).size, 5);
});

test('TEST 2: a company-specific annual holiday change in 募集要項 is meaningful without an update keyword', () => {
  const before = analyzeMynavi({ holiday: '124' });
  const after = analyzeMynavi({ holiday: '125' });
  const change = compareSnapshots(serializeSnapshot(before), after);
  assert.ok(change);
  assert.ok(change.added.some((item) => item.text === '125日'));
  assert.equal(classifyChange(change.added.map((item) => item.text), change.sectionLabel), 'job_info_updated');
});

test('TEST 3: global header and banner copy changes do not enter the extracted snapshot', () => {
  const before = analyzeMynavi({ header: 'マイナビ 共通ヘッダー', banner: '共通キャンペーンのお知らせ' });
  const after = analyzeMynavi({ header: 'マイナビ 新しい共通ヘッダー', banner: '共通キャンペーンが更新されました' });
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('TEST 4: login state changes are excluded from the company-specific diff', () => {
  const before = analyzeMynavi({ login: 'ログインしてマイページをご利用ください' });
  const after = analyzeMynavi({ login: 'ログアウトしました。マイページへ戻る' });
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('TEST 5: recommendation module changes are excluded', () => {
  const before = analyzeMynavi({ recommendation: 'おすすめ企業A' });
  const after = analyzeMynavi({ recommendation: 'おすすめ企業Bと関連企業C' });
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('TEST 6: a date change in the company-specific briefing section is detected and classified', () => {
  const before = analyzeMynavi({ briefingDate: '10/20' });
  const after = analyzeMynavi({ briefingDate: '10/25' });
  const change = compareSnapshots(serializeSnapshot(before), after);
  assert.ok(change);
  assert.ok(change.added.some((item) => item.text.includes('10/25')));
  assert.equal(classifyChange(change.added.map((item) => item.text), change.sectionLabel), 'briefing_open');
});

test('TEST 7: recruitment detail changes are detected even when 最終更新日 stays unchanged', () => {
  const before = analyzeMynavi({ holiday: '124', updated: '2026/2/4' });
  const after = analyzeMynavi({ holiday: '125', updated: '2026/2/4' });
  assert.ok(compareSnapshots(serializeSnapshot(before), after));
});

test('TEST 8: missing, legacy, and extractor-incompatible snapshots silently establish a new baseline', () => {
  const current = analyzeMynavi({ holiday: '125' });
  assert.equal(hasCompatibleSnapshot(null, current), false);
  assert.equal(compareSnapshots(null, current), null);
  assert.equal(hasCompatibleSnapshot('旧版の全ページテキスト\n募集要項', current), false);
  assert.equal(compareSnapshots('旧版の全ページテキスト\n募集要項', current), null);

  const first = serializeSnapshot(current);
  const changedAdapter = { ...current, adapter: 'new-adapter' };
  assert.equal(hasCompatibleSnapshot(first, changedAdapter), false);
  assert.equal(compareSnapshots(first, changedAdapter), null);
});
