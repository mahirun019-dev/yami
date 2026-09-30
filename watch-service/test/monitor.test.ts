import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, compareSnapshots, detectMeaningfulChange, extractMeaningfulText, fetchPage, findPlatformSharedChanges, hasCompatibleSnapshot, inspectRecruitmentContent, normalizeUrl, robotsDecision, serializeSnapshot } from '../src/monitor';

const mynaviUrl = 'https://job.mynavi.jp/28/pc/corpinfo/displayPrevEmployment/index/?corpId=292189&recruitingCourseId=27052359';

type MynaviPageOptions = {
  holiday?: string;
  location?: string;
  briefingDate?: string;
  selectionFlow?: string;
  header?: string;
  banner?: string;
  login?: string;
  recommendation?: string[];
  recommendationInsideCompanyInfo?: boolean;
  recommendationClass?: string;
  recommendationUseIds?: boolean;
  reservation?: string;
  updated?: string;
  pageCompanyName?: string;
  expectedCompanyName?: string;
};

function mynaviPage(options: MynaviPageOptions = {}) {
  const recommendations = options.recommendation || ['おすすめ企業A', 'おすすめ企業B', 'おすすめ企業C'];
  const useRecommendationIds = options.recommendationUseIds !== false;
  const recommendationCards = recommendations.map((name, index) => `
    <div ${useRecommendationIds ? `id="aiRcmdRelInfoDtoList[${index}]"` : ''}>
      <div ${useRecommendationIds ? `id="aiRcmdRelInfoDtoList[${index}].relCorpName"` : ''}>${name}</div>
      <p>インターンシップ＆キャリア</p>
      <dl><dt>業種</dt><dd>ソフトウエア</dd><dt>本社</dt><dd>東京都</dd></dl>
      <a>検討リスト登録</a>
    </div>`).join('');
  const recommendationModule = `<div class="${options.recommendationClass ?? 'aiRecomend recomend'}">
    <div class="${useRecommendationIds ? 'aiPickup' : ''}"><div ${useRecommendationIds ? 'id="corpName"' : ''}>${options.pageCompanyName || 'テスト企業'}の画像と似た雰囲気の画像から企業をおすすめしています。</div></div>
    <div ${useRecommendationIds ? 'id="aiRcmdRelInfoDtoList"' : ''}>${recommendationCards}</div>
  </div>`;
  return `<!doctype html><html><body id="companyDetail">
    <header><p>${options.header || 'マイナビ 共通ヘッダー'}</p></header>
    <div class="global-banner"><p>${options.banner || '共通キャンペーンのお知らせ'}</p></div>
    <div class="wrapper">
      <form id="displayOutlineForm">
        <div id="companyHead" class="group">
          <h1>${options.pageCompanyName || 'テスト企業'}</h1>
          <h2>業種</h2><p>ソフトウエア</p><h2>基本情報</h2><p>本社 東京都</p>
        </div>
        <div class="companyInfo">
          <div class="companySec"><h2>募集要項</h2><dl><dt>年間休日</dt><dd>${options.holiday || '124'}日</dd><dt>募集職種</dt><dd>システムエンジニア</dd></dl></div>
          <div class="companySec"><h2>勤務地</h2><p>${options.location || '東京都'}</p></div>
          <div class="companySec"><h2>募集要項・採用フロー</h2><p>${options.selectionFlow || '書類選考、一次面接'}</p></div>
          <div class="companySec"><h2>説明会・セミナー</h2><p>開催日：${options.briefingDate || '10/20'}</p></div>
          <div class="companySec"><h2>採用後の待遇</h2><p>初任給 250,000円、福利厚生あり。</p></div>
          <div class="companySec"><h2>企業からのお知らせ</h2><p>採用情報を公開しています。</p><p>最終更新日：${options.updated || '2026/2/4'}</p></div>
          <div class="session-ui"><p>${options.login || 'ログインしてマイページをご利用ください'}</p><p>${options.reservation || ''}</p></div>
          ${options.recommendationInsideCompanyInfo ? recommendationModule : ''}
        </div>
        ${options.recommendationInsideCompanyInfo ? '' : `<div class="footerWrap">${recommendationModule}</div>`}
      </form>
    </div>
  </body></html>`;
}

function analyzeMynavi(options: MynaviPageOptions = {}) {
  return inspectRecruitmentContent(mynaviPage(options), 'mynavi', mynaviUrl, options.expectedCompanyName);
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

test('Aiming regression: changing MyNavi AI recommendation cards outside companyInfo does not create a diff', () => {
  const identity = { pageCompanyName: '(株)Aiming', expectedCompanyName: '株式会社Aiming' };
  const before = analyzeMynavi({ ...identity, recommendation: ['(株)サクセス', '(株)スパイク・チュンソフト', '(株)ラクジン'] });
  const after = analyzeMynavi({ ...identity, recommendation: ['(株)オルカ', '(株)f4samurai', '(株)バンダイナムコエンターテインメント', '(株)ゲームフリーク'] });
  assert.equal(before.identityMatched, true);
  assert.ok(before.sections.some((section) => section.label === '募集要項'));
  assert.ok(before.excludedSections.some((section) => section.selector.includes('.aiRecomend') && section.reason === 'platform-recommendation-or-related-list'));
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('Keiyo regression: changing other-company cards does not enter the company-specific snapshot', () => {
  const identity = { pageCompanyName: '京葉ガス情報システム(株)【京葉ガスグループ】', expectedCompanyName: '京葉ガス情報システム(株)' };
  const before = analyzeMynavi({ ...identity, recommendation: ['ドコモ・データコム(株)', '(株)インフォテクノ朝日', '(株)中央コンピュータシステム'] });
  const after = analyzeMynavi({ ...identity, recommendation: ['味の素AGF(株)', '成田国際空港(株)', '東京ガス', 'NEXCOシステムソリューションズ'] });
  assert.equal(before.identityMatched, true);
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('a repeated company-card structure inside the whitelisted root is excluded as a whole', () => {
  const before = analyzeMynavi({ recommendationInsideCompanyInfo: true, recommendationClass: '', recommendationUseIds: false });
  const after = analyzeMynavi({ recommendationInsideCompanyInfo: true, recommendationClass: '', recommendationUseIds: false, recommendation: ['(株)オルカ', '(株)f4samurai', '(株)バンダイナムコ'] });
  assert.ok(before.excludedSections.some((section) => section.reason === 'repeated-company-card-pattern'));
  assert.equal(compareSnapshots(serializeSnapshot(before), after), null);
});

test('a different検討リスト card order is excluded independently of visible text changes', () => {
  const before = analyzeMynavi({ recommendation: ['企業A', '企業B', '企業C'] });
  const after = analyzeMynavi({ recommendation: ['企業C', '企業A', '企業D'] });
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

test('company-specific 勤務地 changes are detected', () => {
  const before = analyzeMynavi({ location: '東京都' });
  const after = analyzeMynavi({ location: '東京都・千葉県' });
  const change = compareSnapshots(serializeSnapshot(before), after);
  assert.ok(change);
  assert.equal(change.sectionLabel, '勤務地');
  assert.ok(change.added.some((item) => item.text === '東京都・千葉県'));
});

test('company-specific 選考フロー additions are detected', () => {
  const before = analyzeMynavi({ selectionFlow: '書類選考、一次面接' });
  const after = analyzeMynavi({ selectionFlow: '書類選考、一次面接、二次面接' });
  const change = compareSnapshots(serializeSnapshot(before), after);
  assert.ok(change);
  assert.ok(change.added.some((item) => item.text.includes('二次面接')));
  assert.equal(classifyChange(change.added.map((item) => item.text), change.sectionLabel), 'selection_updated');
});

test('a mismatched MyNavi company identity cannot create a usable snapshot', () => {
  const result = analyzeMynavi({ pageCompanyName: '(株)Aiming', expectedCompanyName: '別の企業' });
  assert.equal(result.identityMatched, false);
  assert.equal(result.valid, false);
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
