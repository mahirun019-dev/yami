import { load, type CheerioAPI } from "cheerio";
import robotsParser from "robots-parser";
import type { EventType, SourceHealthStatus, SourceType } from "./types";

const RECRUITMENT = /(エントリー|プレエントリー|応募|募集|新卒|採用|説明会|セミナー|予約|インターン|オープン[・\s-]?カンパニー|ES|エントリーシート|提出|締切|適性検査|Web\s*テスト|面接|選考|受付開始|受付終了)/i;
const HIGH_CONFIDENCE_RECRUITMENT = /(募集(?:を)?終了|受付終了|エントリー受付中|応募受付中|説明会受付中|予約受付中|採用予定|募集要項|新卒採用|採用情報|募集職種|採用スケジュール)/i;
const COMPANY_SECTION = /(会社概要|会社情報|会社データ|企業概要|企業情報|採用データ|採用情報|募集要項|募集コース|募集職種|仕事内容|職務内容|応募資格|応募条件|採用人数|採用実績|選考フロー|選考方法|選考情報|説明会|セミナー|インターン|オープン[・\s-]?カンパニー|勤務条件|勤務地|待遇|福利厚生|初任給|給与|休日|休暇|企業からのお知らせ|会社からのお知らせ|採用のお知らせ|採用後の待遇|採用担当者からの伝言板|問合せ先|問い合わせ先)/i;
const PLATFORM_SECTION = /(おすすめ企業|オススメ企業|関連企業|関連会社|類似企業|あなたへのおすすめ|注目企業|他社一覧|企業一覧|検討リスト|エントリー予約リスト|ランキング|人気企業|広告|スポンサー|キャンペーン|閲覧履歴|最近見た企業|(?:マイナビ|リクナビ|サイト|運営|プラットフォーム)からのお知らせ|メンテナンス(?:情報|のお知らせ))/i;
const PERSONALIZED_LINE = /(マイページ|ログイン|ログアウト|会員登録|閲覧履歴|お気に入り登録|保存した企業|応募済み|エントリー予約|予約リスト|(?:エントリー|応募|予約).{0,40}(?:追加|登録|完了|しました|済み|一覧|リスト)|(?:追加|登録|完了|しました|済み|一覧|リスト).{0,40}(?:エントリー|応募|予約))/i;
const SNAPSHOT_VERSION = 4;
const PRIVATE_HOST = /(^localhost$|\.localhost$|\.local$|\.internal$|^0\.|^10\.|^127\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^::1$|^fc|^fd|^fe80)/i;
const CRAWLER_PRODUCT_TOKEN = 'CareerFlowWatch';
const CRAWLER_USER_AGENT = `${CRAWLER_PRODUCT_TOKEN}/1.0 (+public recruitment monitor)`;

export type SnapshotSection = {
  label: string;
  selector: string;
  scope: 'company' | 'fallback';
  lines: string[];
  meaningfulLines: string[];
};

export type RecruitmentAnalysis = {
  adapter: string;
  selector: string;
  rawTextLength: number;
  cleanedTextLength: number;
  recruitmentTextLength: number;
  highConfidenceLines: string[];
  text: string;
  sections: SnapshotSection[];
  excludedSections: Array<{ heading: string; selector: string; normalizedTextLength: number; reason: string }>;
  identityMatched: boolean | null;
  detectedCompanyName: string | null;
  rawLines: string[];
  ignored: Record<string, number>;
  valid: boolean;
};

export type SnapshotChange = {
  added: Array<{ text: string; sectionLabel: string; selector: string; scope: 'company' | 'fallback' }>;
  removed: Array<{ text: string; sectionLabel: string; selector: string; scope: 'company' | 'fallback' }>;
  normalizedAdded: string[];
  normalizedRemoved: string[];
  beforeExcerpt: string;
  afterExcerpt: string;
  sectionLabel: string;
  selector: string;
  scope: 'company' | 'fallback';
  sectionKey: string;
  sharedChange: string;
};

type StoredSnapshot = { version: number; adapter: string; selector: string; sections: SnapshotSection[] };

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL_SCHEME');
  if (url.username || url.password) throw new Error('URL_CREDENTIALS');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('URL_PORT');
  if (PRIVATE_HOST.test(url.hostname) || /^\[.*\]$/.test(url.hostname)) throw new Error('URL_PRIVATE_HOST');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_') || /^(fbclid|gclid|yclid)$/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

const CONTENT_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,time';
const EXCLUDED_DOM = [
  'script', 'style', 'noscript', 'svg', 'canvas', 'template', 'nav', 'header', 'footer', 'aside',
  'form', 'input', 'button', 'select', 'textarea', '[hidden]', '[aria-hidden="true"]',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
  '[class*="global-nav" i]', '[id*="global-nav" i]', '[class*="gnav" i]', '[id*="gnav" i]',
  '[class*="global-banner" i]', '[id*="global-banner" i]', '[class*="site-banner" i]', '[id*="site-banner" i]',
  '[class*="top-banner" i]', '[id*="top-banner" i]', '[class*="header-banner" i]', '[id*="header-banner" i]',
  '[class*="breadcrumb" i]', '[id*="breadcrumb" i]', '[class*="cookie" i]', '[id*="cookie" i]',
  '[class*="recommend" i]', '[id*="recommend" i]', '[class*="related" i]', '[id*="related" i]',
  '[class*="carousel" i]', '[id*="carousel" i]', '[class*="campaign" i]', '[id*="campaign" i]',
  '[class*="advert" i]', '[id*="advert" i]', '[id*="analytics" i]', '[class*="analytics" i]',
].join(',');
const MYNAVI_RECOMMENDATION_DOM = [
  '.aiRecomend', '.recomend', '[id*="aiRcmd" i]',
  '[class*="aiPickup" i]', '[id*="aiPickup" i]', '[class*="recommend" i]', '[id*="recommend" i]',
  '[class*="related" i]', '[id*="related" i]',
].join(',');
const HEADING_NODES = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

function normalizeLine(value: string): string {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[\s\u00a0]+/g, ' ').trim();
}

function ignoredReason(line: string): string | null {
  if (!line || line.length < 2) return 'empty';
  if (/^(?:最終更新(?:日)?|更新日時?|更新日|generated|page generated|アクセス解析)\s*[:：]?\s*(?:20\d{2}|\d{4})/i.test(line)) return 'update-metadata';
  if (/^(?:20\d{2}[./年-]\d{1,2}[./月-]\d{1,2}日?\s*)?(?:更新|最終更新|updated)(?:日|日時)?\s*[:：]?\s*20\d{2}/i.test(line)) return 'update-metadata';
  if (/^(?:20\d{2}[./年-]\d{1,2}[./月-]\d{1,2}日?\s*)?(?:\d{1,2}:\d{2}(?::\d{2})?)$/.test(line)) return 'standalone-timestamp';
  if (PERSONALIZED_LINE.test(line)) return 'personalized-or-session-ui';
  if (/^(?:閲覧数|アクセス数|お気に入り数|いいね数|通知数|残り時間|カウントダウン)\s*[:：]?\s*[\d,０-９]+(?:件|人|回|秒|分|時間|日)?$/i.test(line)) return 'dynamic-count';
  if (/^(?:マイナビ|リクナビ|ホーム|トップ|企業検索|ログイン|ログアウト|会員登録|おすすめ|関連企業|広告|スポンサー|キャンペーン|cookie|クッキー)$/i.test(line)) return 'platform-chrome';
  if (/^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24,}|[a-z0-9_-]{36,})$/i.test(line)) return 'generated-id';
  if (/(?:session|csrf|xsrf|token)\s*[=:]/i.test(line)) return 'session-token';
  return null;
}

function collectBlockLines($: CheerioAPI, node: any): string[] {
  const lines: string[] = [];
  $(node).find(CONTENT_BLOCKS).each((_index, element) => {
    const text = normalizeLine($(element).text());
    if (text) lines.push(text);
  });
  if (!lines.length) {
    const text = normalizeLine($(node).text());
    if (text) lines.push(text);
  }
  return [...new Set(lines)];
}

function cleanLines(rawLines: string[], ignored: Record<string, number>) {
  const lines: string[] = [];
  for (const raw of rawLines) {
    const line = normalizeLine(raw);
    const reason = ignoredReason(line);
    if (reason) {
      ignored[reason] = (ignored[reason] || 0) + 1;
      continue;
    }
    if (line.length <= 600) lines.push(line);
  }
  return [...new Set(lines)];
}

function rootForPage($: CheerioAPI, sourceType: SourceType, inputUrl?: string) {
  let hostname = '';
  try { hostname = inputUrl ? new URL(inputUrl).hostname.toLowerCase() : ''; } catch { /* URL is optional for fixture callers. */ }
  const isMynavi = sourceType === 'mynavi' || hostname === 'mynavi.jp' || hostname.endsWith('.mynavi.jp');
  const isRikunabi = hostname === 'rikunabi.com' || hostname.endsWith('.rikunabi.com');
  const adapter = isMynavi ? 'mynavi-v3' : isRikunabi ? 'rikunabi-v2' : sourceType === 'official' ? 'official-main-v2' : 'generic-main-v2';
  if (isMynavi) {
    const companyInfo = $('.companyInfo, #companyInfo').first();
    if (companyInfo.length && normalizeLine(companyInfo.text()).length >= 40) return { root: companyInfo, selector: '.companyInfo', adapter, isMynavi };
    return { root: $([]), selector: 'mynavi-company-whitelist-unavailable', adapter, isMynavi };
  }
  const selectors = isRikunabi
    ? ['main', '[role="main"]', '#contents', '#main', 'article']
    : ['main', '[role="main"]', 'article', '#mainContents', '#main', '#contents', '.mainContents'];
  for (const selector of selectors) {
    const candidate = $(selector).first();
    if (candidate.length && normalizeLine(candidate.text()).length >= 40) return { root: candidate, selector, adapter, isMynavi };
  }
  const contentCandidate = $('[class*="main-content" i], [id*="main-content" i], [class*="maincontents" i], [id*="maincontents" i]').first();
  if (contentCandidate.length && normalizeLine(contentCandidate.text()).length >= 40) {
    return { root: contentCandidate, selector: 'main-content-fallback', adapter, isMynavi };
  }
  return { root: $('body'), selector: 'body-recruitment-lines-only', adapter, isMynavi };
}

function domSelector($: CheerioAPI, node: any): string {
  const $node = $(node);
  const tag = String($node.prop('tagName') || 'node').toLowerCase();
  const id = $node.attr('id');
  const classes = ($node.attr('class') || '').split(/\s+/).filter(Boolean).slice(0, 3);
  return `${tag}${id ? `#${id}` : ''}${classes.map((name) => `.${name}`).join('')}`;
}

function repeatedMynaviCompanyCards($: CheerioAPI, node: any): boolean {
  const $node = $(node);
  const text = normalizeLine($node.text());
  const names = $node.find('[id*="relCorpName" i]').length;
  const industries = $node.find('[id*="relInd" i]').length;
  const headquarters = $node.find('[id*="relHq" i]').length;
  if (names >= 3 && industries >= 3 && headquarters >= 3) return true;
  const count = (pattern: RegExp) => (text.match(pattern) || []).length;
  return count(/検討リスト登録/g) >= 3 && count(/業種/g) >= 3 && count(/本社/g) >= 3;
}

function captureMynaviExcludedSections($: CheerioAPI, companyInfo: any) {
  const excluded: Array<{ heading: string; selector: string; normalizedTextLength: number; reason: string }> = [];
  const explicitNodes = $(MYNAVI_RECOMMENDATION_DOM).toArray();
  const explicitSet = new Set(explicitNodes);
  const explicitRoots = explicitNodes.filter((node: any) => !$(node).parents().toArray().some((parent: any) => explicitSet.has(parent)));
  const seen = new Set<any>(explicitRoots);
  for (const node of explicitRoots) {
    const $node = $(node);
    const heading = normalizeLine($node.find(HEADING_NODES).first().text()) ||
      (normalizeLine($node.find('#corpName').first().text()).slice(0, 100) || 'MyNavi recommendation / related-company module');
    excluded.push({ heading, selector: domSelector($, node), normalizedTextLength: normalizeLine($node.text()).length, reason: 'platform-recommendation-or-related-list' });
  }
  $(HEADING_NODES).each((_index, node) => {
    const heading = normalizeLine($(node).text());
    const insideExplicitModule = $(node).parents().toArray().some((parent: any) => explicitSet.has(parent));
    if (!heading || !PLATFORM_SECTION.test(heading) || seen.has(node) || insideExplicitModule) return;
    seen.add(node);
    excluded.push({ heading: heading.slice(0, 100), selector: domSelector($, node), normalizedTextLength: heading.length, reason: 'platform-or-personalized-section-heading' });
  });

  if (companyInfo?.length) {
    const candidates = $(companyInfo).find('section,article,aside,[role="region"],div').toArray()
      .filter((node: any) => repeatedMynaviCompanyCards($, node) && !$(node).parents().toArray().some((parent: any) => explicitSet.has(parent)));
    const candidateSet = new Set(candidates);
    const smallest = candidates.filter((node: any) => !$(node).find('section,article,aside,[role="region"],div').toArray().some((child: any) => candidateSet.has(child)));
    for (const node of smallest) {
      if (seen.has(node)) continue;
      seen.add(node);
      excluded.push({ heading: '繰り返し企業カード一覧', selector: domSelector($, node), normalizedTextLength: normalizeLine($(node).text()).length, reason: 'repeated-company-card-pattern' });
    }
  }
  return excluded;
}

function removeRepeatedMynaviCompanyCards($: CheerioAPI, companyInfo: any) {
  if (!companyInfo?.length) return;
  const explicit = new Set($(MYNAVI_RECOMMENDATION_DOM).toArray());
  const candidates = $(companyInfo).find('section,article,aside,[role="region"],div').toArray()
    .filter((node: any) => repeatedMynaviCompanyCards($, node));
  const candidateSet = new Set(candidates);
  const smallest = candidates.filter((node: any) => !$(node).find('section,article,aside,[role="region"],div').toArray().some((child: any) => candidateSet.has(child)));
  for (const node of smallest) {
    if (explicit.has(node)) continue;
    $(node).remove();
  }
  for (const node of explicit) $(node).remove();
}

export function companyIdentityKey(value: string): string {
  return normalizeLine(value).normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[【［\[(（][^】］\])）]*(?:グループ|グループ会社)[^】］\])）]*[】］\])）]/g, '')
    .replace(/株式会社|有限会社|合同会社|合名会社|合資会社|\(株\)|\(有\)|\(同\)|\(名\)|\(資\)/g, '')
    .replace(/[\p{P}\p{S}\s\u00a0]/gu, '');
}

export function matchesCompanyIdentity(expected: string, actual: string): boolean {
  const expectedKey = companyIdentityKey(expected);
  const actualKey = companyIdentityKey(actual);
  return expectedKey.length >= 2 && actualKey.length >= 2 && expectedKey === actualKey;
}

type IdentityCandidate = { value: string; source: string; explicit: boolean };

function cleanIdentityCandidate(value: string): string {
  return normalizeLine(value)
    .replace(/\s*(?:\||｜|・| - | – | — ).*$/, '')
    .replace(/(?:の)?(?:新卒採用|新卒募集|採用情報|採用サイト|募集要項|リクルートサイト|RECRUIT(?:MENT)?|CAREERS?)\s*$/i, '')
    .replace(/^\d{4}年度?\s*/, '')
    .trim();
}

function findIdentityCandidates($: CheerioAPI, sourceType: SourceType, inputUrl?: string): IdentityCandidate[] {
  const candidates: IdentityCandidate[] = [];
  const add = (value: string, source: string, explicit: boolean) => {
    const cleaned = cleanIdentityCandidate(value);
    if (cleaned && companyIdentityKey(cleaned)) candidates.push({ value: cleaned, source, explicit });
  };
  const host = (() => { try { return inputUrl ? new URL(inputUrl).hostname.toLowerCase() : ''; } catch { return ''; } })();
  const isMynavi = sourceType === 'mynavi' || host === 'mynavi.jp' || host.endsWith('.mynavi.jp');
  if (isMynavi) add($('#companyHead h1').first().text() || $('#companyHead').find('h1').first().text(), 'mynavi-company-heading', true);
  else {
    const siteName = $('meta[property="og:site_name"]').attr('content') || $('meta[name="application-name"]').attr('content') || '';
    add(siteName, 'site-name', /(?:株式会社|有限会社|合同会社|\(株\)|\(有\))/i.test(siteName));
    $('[itemprop="name"], [class*="company-name" i], [class*="corp-name" i], [class*="company_name" i], [class*="corp_name" i]').each((_index, node) => {
      const value = $(node).text();
      add(value, 'company-name-element', /(?:株式会社|有限会社|合同会社|\(株\)|\(有\))/i.test(value));
    });
    $('main h1, [role="main"] h1, article h1, h1').each((_index, node) => {
      const value = $(node).text();
      if (/^(?:新卒採用|採用情報|募集要項|採用サイト|recruit(?:ment)?|careers?)$/i.test(normalizeLine(value))) return;
      add(value, 'heading', true);
    });
    const title = $('title').first().text();
    for (const part of normalizeLine(title).split(/\s*(?:\||｜| - | – | — )\s*/)) add(part, 'title', /(?:株式会社|有限会社|合同会社|\(株\)|\(有\))/i.test(part));
  }
  return candidates.filter((candidate, index) => candidates.findIndex((item) => companyIdentityKey(item.value) === companyIdentityKey(candidate.value)) === index);
}

export function evaluateIdentity(analysis: Pick<RecruitmentAnalysis, 'identityMatched' | 'valid'>): SourceHealthStatus | null {
  if (analysis.identityMatched === false) return 'identity_mismatch';
  if (!analysis.valid) return 'extraction_failed';
  if (analysis.identityMatched === null) return 'needs_review';
  return null;
}

export function classifyFetchFailure(message: string): SourceHealthStatus {
  if (message === 'LOGIN_REQUIRED' || message === 'ACCESS_RESTRICTED') return 'auth_required';
  if (message === 'INSUFFICIENT_PUBLIC_CONTENT' || message === 'UNSUPPORTED_CONTENT_TYPE') return 'extraction_failed';
  if (message === 'ROBOTS_DISALLOWED' || message === 'ROBOTS_POLICY_UNVERIFIABLE' || message === 'RATE_LIMITED') return 'needs_review';
  if (/^(?:HTTP_(?:4\d\d|5\d\d)|DNS_CHECK_FAILED|URL_|REDIRECT_|TOO_MANY_REDIRECTS|FETCH_|UND_ERR_|ECONN|ETIMEDOUT|TIMEOUT|UNKNOWN_ERROR)/.test(message)) return 'unreachable';
  return 'needs_review';
}

function siblingSectionLines($: CheerioAPI, heading: any): string[] {
  const $parent = $(heading).parent();
  const $anchor = $parent.children().length === 1 ? $parent : $(heading);
  const tag = String($anchor.prop('tagName') || '').toLowerCase();
  const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 6;
  const raw: string[] = [normalizeLine($(heading).text())];
  $anchor.nextAll().each((_index, sibling) => {
    const $sibling = $(sibling);
    const nextHeading = $sibling.is('h1,h2,h3,h4,h5,h6,[role="heading"]') ? $sibling : $sibling.find('h1,h2,h3,h4,h5,h6,[role="heading"]').first();
    if (nextHeading.length) {
      const nextTag = String(nextHeading.prop('tagName') || '').toLowerCase();
      const nextLevel = /^h[1-6]$/.test(nextTag) ? Number(nextTag[1]) : Number(nextHeading.attr('aria-level') || 6);
      if (nextLevel <= level) return false;
    }
    raw.push(...collectBlockLines($, sibling));
    return undefined;
  });
  return [...new Set(raw.filter(Boolean))];
}

function removePlatformModules($: CheerioAPI, root: any) {
  $(root).find(HEADING_NODES).each((_index, heading) => {
    const label = normalizeLine($(heading).text());
    if (!label || !PLATFORM_SECTION.test(label)) return;
    const ancestors = $(heading).parentsUntil(root).toArray();
    const module = ancestors.find((ancestor: any) => {
      const $ancestor = $(ancestor);
      const text = normalizeLine($ancestor.text());
      if (!$ancestor.is('section,article,aside,[role="region"],div') || text.length < label.length + 8 || text.length > 12_000) return false;
      const hasOtherCompanySection = $ancestor.find(HEADING_NODES).toArray().some((other: any) => other !== heading && COMPANY_SECTION.test(normalizeLine($(other).text())) && !PLATFORM_SECTION.test(normalizeLine($(other).text())));
      return !hasOtherCompanySection;
    });
    if (module) {
      $(module).remove();
      return;
    }

    const parent = $(heading).parent();
    const anchor = parent.children().length === 1 ? parent : $(heading);
    const level = headingLevel($, heading);
    anchor.nextAll().each((_siblingIndex, sibling) => {
      const $sibling = $(sibling);
      const nextHeading = $sibling.is(HEADING_NODES) ? $sibling : $sibling.find(HEADING_NODES).first();
      if (nextHeading.length && headingLevel($, nextHeading[0]) <= level) return false;
      $sibling.remove();
      return undefined;
    });
    $(heading).remove();
  });
}

function headingLevel($: CheerioAPI, heading: any): number {
  const tag = String($(heading).prop('tagName') || '').toLowerCase();
  return /^h[1-6]$/.test(tag) ? Number(tag[1]) : Number($(heading).attr('aria-level') || 6);
}

function extractCompanySections($: CheerioAPI, root: any, ignored: Record<string, number>): SnapshotSection[] {
  const sections: SnapshotSection[] = [];
  const seen = new Set<string>();
  $(root).find(HEADING_NODES).each((_index, heading) => {
    const label = normalizeLine($(heading).text());
    const level = headingLevel($, heading);
    if (!label || level < 2 || label.length > 80 || !COMPANY_SECTION.test(label) || PLATFORM_SECTION.test(label)) return;
    const $container = $(heading).closest('section,article,[class*="section" i],[id*="section" i],[class*="block" i],[id*="block" i]');
    let rawLines: string[];
    let selector: string;
    const containerHeadings = $container.find(HEADING_NODES).toArray();
    const hasPeerCompanyHeading = containerHeadings.some((other: any) => other !== heading && headingLevel($, other) <= level && COMPANY_SECTION.test(normalizeLine($(other).text())) && !PLATFORM_SECTION.test(normalizeLine($(other).text())));
    if ($container.length && $container[0] !== root && normalizeLine($container.text()).length <= 12_000 && !hasPeerCompanyHeading) {
      rawLines = collectBlockLines($, $container[0]);
      selector = 'company-section-container';
    } else {
      rawLines = siblingSectionLines($, heading);
      selector = `heading:${String($(heading).prop('tagName') || 'role').toLowerCase()}`;
    }
    const cleaned = cleanLines(rawLines.filter((line) => normalizeLine(line) !== label), ignored);
    if (!cleaned.length) return;
    const key = `${label.toLowerCase()}\n${cleaned.join('\n')}`;
    if (seen.has(key)) return;
    seen.add(key);
    sections.push({ label, selector, scope: 'company', lines: cleaned, meaningfulLines: cleaned });
  });
  return sections;
}

function extractMynaviSections($: CheerioAPI, companyInfo: any, ignored: Record<string, number>): SnapshotSection[] {
  const sections: SnapshotSection[] = [];
  const companyHeader = $('#companyHead').first();
  if (companyHeader.length) {
    const lines = cleanLines(collectBlockLines($, companyHeader[0]), ignored);
    if (lines.length) sections.push({ label: '会社概要', selector: '#companyHead', scope: 'company', lines, meaningfulLines: lines });
  }
  if (companyInfo?.length) sections.push(...extractCompanySections($, companyInfo[0], ignored));
  return [...new Map(sections.map((section) => [`${section.label}\n${section.selector}\n${section.lines.join('\n')}`, section])).values()];
}

function meaningfulFallbackLines(lines: string[]) {
  return lines.filter((line) => RECRUITMENT.test(line));
}

function normalizedSnapshot(analysis: Pick<RecruitmentAnalysis, 'adapter' | 'selector' | 'sections'>): StoredSnapshot {
  return { version: SNAPSHOT_VERSION, adapter: analysis.adapter, selector: analysis.selector, sections: analysis.sections };
}

export function serializeSnapshot(analysis: RecruitmentAnalysis): string {
  return JSON.stringify(normalizedSnapshot(analysis));
}

function parseSnapshot(value: string | null | undefined): StoredSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredSnapshot;
    if (parsed.version !== SNAPSHOT_VERSION || typeof parsed.adapter !== 'string' || typeof parsed.selector !== 'string' || !Array.isArray(parsed.sections)) return null;
    if (!parsed.sections.every((section) => section && typeof section.label === 'string' && typeof section.selector === 'string' && (section.scope === 'company' || section.scope === 'fallback') && Array.isArray(section.lines) && section.lines.every((line) => typeof line === 'string') && Array.isArray(section.meaningfulLines))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasCompatibleSnapshot(value: string | null | undefined, analysis: RecruitmentAnalysis): boolean {
  const previous = parseSnapshot(value);
  return Boolean(previous && previous.adapter === analysis.adapter && previous.selector === analysis.selector);
}

export function snapshotLines(value: string | null | undefined): string[] {
  const previous = parseSnapshot(value);
  return previous ? previous.sections.flatMap((section) => section.lines) : (value || '').split('\n').filter(Boolean);
}

export function redactDiagnosticLine(value: string): string {
  const line = normalizeLine(value);
  const reason = ignoredReason(line);
  return reason ? `[${reason}]` : line.slice(0, 240);
}

export function compareSnapshots(before: string | null | undefined, after: RecruitmentAnalysis): SnapshotChange | null {
  const previous = parseSnapshot(before);
  if (!previous || previous.adapter !== after.adapter || previous.selector !== after.selector) return null;
  const oldRecords = new Map<string, SnapshotSection>();
  const newRecords = new Map<string, SnapshotSection>();
  for (const section of previous.sections) for (const line of section.lines) if (!oldRecords.has(line)) oldRecords.set(line, section);
  for (const section of after.sections) for (const line of section.lines) if (!newRecords.has(line)) newRecords.set(line, section);
  const isMeaningful = (line: string, section: SnapshotSection) => {
    if (line.length < 2 || ignoredReason(line)) return false;
    return section.scope === 'company' ? COMPANY_SECTION.test(section.label) : section.meaningfulLines.includes(line) && RECRUITMENT.test(line);
  };
  const addedRecords = [...newRecords].filter(([line]) => !oldRecords.has(line)).map(([text, section]) => ({ text, section }));
  const removedRecords = [...oldRecords].filter(([line]) => !newRecords.has(line)).map(([text, section]) => ({ text, section }));
  const meaningfulAdded = addedRecords.filter(({ text, section }) => isMeaningful(text, section));
  const meaningfulRemoved = removedRecords.filter(({ text, section }) => isMeaningful(text, section));
  if (!meaningfulAdded.length && !meaningfulRemoved.length) return null;
  const uniqueAdded = [...new Map(meaningfulAdded.map((record) => [record.text, record])).values()];
  const uniqueRemoved = [...new Map(meaningfulRemoved.map((record) => [record.text, record])).values()];
  const first = uniqueAdded[0] || uniqueRemoved[0];
  const previousExcerpt = uniqueRemoved.slice(0, 4).map((record) => record.text).join('\n') || previous.sections.flatMap((section) => section.lines.filter((line) => RECRUITMENT.test(line))).slice(-4).join('\n');
  const afterExcerpt = uniqueAdded.slice(0, 4).map((record) => record.text).join('\n');
  const added = uniqueAdded.map(({ text, section }) => ({ text, sectionLabel: section.label, selector: section.selector, scope: section.scope }));
  const removed = uniqueRemoved.map(({ text, section }) => ({ text, sectionLabel: section.label, selector: section.selector, scope: section.scope }));
  return {
    added: added.slice(0, 8),
    removed: removed.slice(0, 8),
    normalizedAdded: [...new Set(addedRecords.map((record) => record.text))].slice(0, 12),
    normalizedRemoved: [...new Set(removedRecords.map((record) => record.text))].slice(0, 12),
    beforeExcerpt: previousExcerpt,
    afterExcerpt: afterExcerpt || uniqueRemoved.slice(0, 4).map((record) => record.text).join('\n'),
    sectionLabel: first.section.label,
    selector: first.section.selector,
    scope: first.section.scope,
    sectionKey: `${first.section.scope}:${normalizeLine(first.section.label).toLowerCase() || first.section.selector}`,
    sharedChange: [...uniqueAdded.map((record) => `+${record.text}`), ...uniqueRemoved.map((record) => `-${record.text}`)].slice(0, 8).join('\n'),
  };
}

export function inspectRecruitmentContent(html: string, sourceType: SourceType, inputUrl?: string, targetCompanyName?: string): RecruitmentAnalysis {
  const $ = load(html);
  const rawTextLength = normalizeLine($('body').text()).length;
  const { root, selector, adapter, isMynavi } = rootForPage($, sourceType, inputUrl);
  const excludedSections = isMynavi ? captureMynaviExcludedSections($, root) : [];
  if (isMynavi) {
    $(MYNAVI_RECOMMENDATION_DOM).remove();
    removeRepeatedMynaviCompanyCards($, root);
  } else {
    $(EXCLUDED_DOM).remove();
  }
  removePlatformModules($, root);
  const ignored: Record<string, number> = {};
  const rawLines = root.length ? collectBlockLines($, root[0]) : [];
  const cleaned = cleanLines(rawLines, ignored);
  const specificSections = isMynavi
    ? extractMynaviSections($, root, ignored)
    : root.length ? extractCompanySections($, root[0], ignored) : [];
  const fallbackMeaningful = isMynavi ? [] : meaningfulFallbackLines(cleaned);
  const fallback = {
    label: '採用関連ページ',
    selector,
    scope: 'fallback' as const,
    lines: fallbackMeaningful,
    meaningfulLines: fallbackMeaningful,
  };
  const sections = specificSections.length ? specificSections : fallback.lines.length ? [fallback] : [];
  const allLines = [...new Set(sections.flatMap((section) => section.lines))].slice(0, 100_000);
  const meaningfulLines = [...new Set(sections.flatMap((section) => section.scope === 'company' ? section.lines : section.meaningfulLines))];
  const highConfidenceLines = meaningfulLines.filter((line) => HIGH_CONFIDENCE_RECRUITMENT.test(line));
  const recruitmentTextLength = meaningfulLines.filter((line) => RECRUITMENT.test(line)).join('\n').length;
  const text = allLines.join('\n').slice(0, 100_000);
  const identityCandidates = findIdentityCandidates($, sourceType, inputUrl);
  const expectedKey = targetCompanyName ? companyIdentityKey(targetCompanyName) : '';
  const matchedCandidate = expectedKey ? identityCandidates.find((candidate) => companyIdentityKey(candidate.value) === expectedKey) : undefined;
  const explicitMismatch = expectedKey ? identityCandidates.find((candidate) => candidate.explicit && companyIdentityKey(candidate.value) !== expectedKey) : undefined;
  const identityMatched = targetCompanyName
    ? matchedCandidate ? true : isMynavi || explicitMismatch ? false : null
    : null;
  const detectedCompanyName = matchedCandidate?.value || explicitMismatch?.value || identityCandidates[0]?.value || null;
  const hasCanonicalMynaviSection = !isMynavi || specificSections.some((section) => section.selector !== '#companyHead');
  return {
    adapter,
    selector: specificSections.length ? (isMynavi ? 'mynavi-company-whitelist' : 'company-sections') : selector,
    rawTextLength,
    cleanedTextLength: text.length,
    recruitmentTextLength,
    highConfidenceLines,
    text,
    sections,
    excludedSections,
    identityMatched,
    detectedCompanyName,
    rawLines,
    ignored,
    valid: hasCanonicalMynaviSection && (meaningfulLines.join('\n').length >= 80 || highConfidenceLines.length > 0),
  };
}

export function extractMeaningfulText(html: string, sourceType: SourceType, inputUrl?: string): string {
  return inspectRecruitmentContent(html, sourceType, inputUrl).text;
}

export function detectMeaningfulChange(before: string, after: string) {
  if (!before || before === after) return null;
  const oldLines = new Set(before.split('\n'));
  const newLines = after.split('\n').filter((line) => !oldLines.has(line));
  const relevant = newLines.filter((line) => RECRUITMENT.test(line));
  if (!relevant.length) return null;
  return { added: relevant.slice(0, 8), beforeExcerpt: before.split('\n').filter((line) => RECRUITMENT.test(line)).slice(-4).join('\n'), afterExcerpt: relevant.slice(0, 4).join('\n') };
}

export type SharedChangeCandidate = { targetId: string; companyId: string; host: string; selector: string; sectionKey: string; scope: 'company' | 'fallback'; text: string; runId?: string };

function compareTextSimilarity(left: string, right: string): number {
  const normalize = (value: string) => normalizeLine(value).toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  const a = normalize(left), b = normalize(right);
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 12) return 0;
  const bigrams = (value: string) => new Set(Array.from({ length: value.length - 1 }, (_item, index) => value.slice(index, index + 2)));
  const aa = bigrams(a), bb = bigrams(b);
  const overlap = [...aa].filter((part) => bb.has(part)).length;
  return (2 * overlap) / (aa.size + bb.size);
}

function platformHost(host: string): string {
  const value = host.toLowerCase().replace(/^www\./, '');
  for (const suffix of ['mynavi.jp', 'rikunabi.com']) if (value === suffix || value.endsWith(`.${suffix}`)) return suffix;
  return value;
}

export function findPlatformSharedChanges(candidates: SharedChangeCandidate[], minCompanies = 3): Set<string> {
  const grouped = new Map<string, SharedChangeCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.scope !== 'fallback' || !candidate.text.trim()) continue;
    const key = `${candidate.runId || ''}\n${platformHost(candidate.host)}\n${candidate.selector}\n${candidate.sectionKey}`;
    grouped.set(key, [...(grouped.get(key) || []), candidate]);
  }
  const ignored = new Set<string>();
  for (const group of grouped.values()) {
    const clusters: SharedChangeCandidate[][] = [];
    for (const candidate of group) {
      const cluster = clusters.find((items) => compareTextSimilarity(items[0].text, candidate.text) >= 0.9);
      if (cluster) cluster.push(candidate);
      else clusters.push([candidate]);
    }
    for (const cluster of clusters) {
      if (new Set(cluster.map((candidate) => candidate.companyId)).size < minCompanies) continue;
      for (const candidate of cluster) ignored.add(candidate.targetId);
    }
  }
  return ignored;
}

export function classifyChange(lines: string[], sectionLabel = ''): EventType {
  const text = lines.join(' ');
  if (/(説明会|セミナー)/.test(sectionLabel)) return 'briefing_open';
  if (/(インターン|オープン[・\s-]?カンパニー)/.test(sectionLabel)) return 'internship_open';
  if (/(選考フロー|選考方法|選考情報|採用フロー)/.test(sectionLabel)) return 'selection_updated';
  if (/(募集要項|募集コース|採用データ|応募資格|待遇|福利厚生|初任給|勤務地|勤務条件)/.test(sectionLabel)) return 'job_info_updated';
  if (/(募集終了|受付終了|締め切りました|終了しました)/.test(text)) return 'recruitment_closed';
  if (/(締切|提出期限|応募期限).*(変更|延長|追加|まで|日)/.test(text)) return 'deadline_changed';
  if (/(説明会|セミナー).*(受付開始|予約開始|開催)/.test(text)) return 'briefing_open';
  if (/(インターン|オープン[・\s-]?カンパニー).*(募集|受付|予約|開始)/.test(text)) return 'internship_open';
  if (/(エントリー|プレエントリー|応募|ES|エントリーシート).*(受付開始|開始しました|募集中|提出受付)/.test(text)) return 'entry_open';
  if (/(面接|適性検査|Web\s*テスト|選考スケジュール|選考フロー)/i.test(text)) return 'selection_updated';
  if (/(募集要項|職種|初任給|勤務地|応募資格)/.test(text)) return 'job_info_updated';
  return 'other_recruitment_update';
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function robotsDecision(robotsUrl: string, contents: string, targetUrl: string): boolean | undefined {
  return robotsParser(robotsUrl, contents).isAllowed(targetUrl, CRAWLER_PRODUCT_TOKEN);
}

async function assertPublicDns(hostname: string) {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { accept: 'application/dns-json' } });
  if (!response.ok) throw new Error('DNS_CHECK_FAILED');
  const body = await response.json() as { Answer?: Array<{ data: string }> };
  if (!body.Answer?.length || body.Answer.some((x) => PRIVATE_HOST.test(x.data))) throw new Error('URL_PRIVATE_HOST');
}

export async function fetchPage(input: string): Promise<{ url: string; html: string; status: number }> {
  let url = normalizeUrl(input);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const parsed = new URL(url);
    await assertPublicDns(parsed.hostname);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    let robotsResponse: Response;
    try {
      robotsResponse = await fetch(robotsUrl, { signal: AbortSignal.timeout(8_000), headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/plain' } });
    } catch {
      throw new Error('ROBOTS_POLICY_UNVERIFIABLE');
    }
    if (robotsResponse.status === 404 || robotsResponse.status === 410) {
      // An absent robots.txt has no disallow rules; transient and restricted responses fail closed below.
    } else if (robotsResponse.ok) {
      const decision = robotsDecision(robotsUrl, await robotsResponse.text(), url);
      if (decision === false) throw new Error('ROBOTS_DISALLOWED');
      if (decision === undefined) throw new Error('ROBOTS_POLICY_UNVERIFIABLE');
    } else throw new Error('ROBOTS_POLICY_UNVERIFIABLE');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/html,application/xhtml+xml' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('REDIRECT_WITHOUT_LOCATION');
      url = normalizeUrl(new URL(location, url).toString());
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new Error('ACCESS_RESTRICTED');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('UNSUPPORTED_CONTENT_TYPE');
    const html = (await response.text()).slice(0, 1_500_000);
    if (/<form[^>]*(?:login|signin)[^>]*>[\s\S]{0,8000}<input[^>]+type=["']password/i.test(html)) throw new Error('LOGIN_REQUIRED');
    return { url, html, status: response.status };
  }
  throw new Error('TOO_MANY_REDIRECTS');
}
