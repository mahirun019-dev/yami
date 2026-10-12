import assert from 'node:assert/strict';
import test from 'node:test';
import { companyWatchKey, companyWatchState, currentMynaviEntryStatus, ENTRY_STATUS_MAX_AGE_MS, verifiedEntryUrl } from '../src/watch/companyStatus.ts';
import { watchText } from '../src/watch/i18n.ts';
import type { WatchTarget } from '../src/watch/types.ts';

const now = Date.parse('2026-10-12T01:40:00Z');
const company = { id: 'local-company', name: '東京ガス i ネット' };
function target(overrides: Partial<WatchTarget> = {}): WatchTarget {
  return {
    id: 'mynavi', company_id: company.id, company_name: company.name, source_type: 'mynavi', label: '',
    url: 'https://job.mynavi.jp/28/pc/search/corp100001/outline.html', enabled: 1, status: 'active',
    health_status: 'healthy', detected_company_name: company.name, last_checked_at: '2026-10-12T00:17:20Z',
    last_success_at: '2026-10-12T00:17:20Z', last_http_status: 200, last_error: null,
    entry_status: 'open', entry_last_checked_at: '2026-10-12T00:17:20Z',
    entry_url: 'https://job.mynavi.jp/28/pc/corp100001/list.html', entry_signal: 'エントリー', ...overrides,
  };
}

test('current healthy open records show Entry without changing monitoring enabled', () => {
  const source = target();
  assert.equal(companyWatchState(company, [source], now), 'open');
  assert.equal(source.enabled, 1);
  assert.equal(verifiedEntryUrl(source), source.entry_url);
});

test('the four production company identities support legal-form and group suffix normalization', () => {
  for (const name of ['(株)アトミテック', '(株)レコモット', '大成建設ICTソリューションズ(株)', '東京ガス i ネット']) {
    const item = { id: 'another-device-id', name };
    const source = target({ company_name: name, detected_company_name: `${name}【企業グループ】` });
    assert.equal(companyWatchState(item, [source], now), 'open');
  }
  assert.equal(companyWatchKey('東京ガスｉネット'), companyWatchKey('東京ガス i ネット(株)'));
});

test('needs_review Entry is never upgraded to open even on a healthy source', () => {
  assert.equal(companyWatchState(company, [target({ entry_status: 'needs_review' })], now), 'review');
});

test('identity mismatch and extraction/access errors invalidate a retained open result', () => {
  for (const health_status of ['identity_mismatch', 'extraction_failed', 'unreachable', 'auth_required', 'source_changed', 'needs_review'] as const) {
    assert.equal(companyWatchState(company, [target({ health_status })], now), 'review');
  }
  assert.equal(companyWatchState(company, [target({ detected_company_name: '(株)エイティング' })], now), 'review');
  assert.equal(companyWatchState(company, [target({ status: 'error', last_error: 'FETCH_FAILED' })], now), 'review');
});

test('all paused sources remove the label despite stored open data', () => {
  assert.equal(companyWatchState(company, [target({ enabled: 0 })], now), null);
  assert.equal(companyWatchState(company, [], now), null);
});

test('an independent official failure cannot override a verified MyNavi open source', () => {
  const official = target({ id: 'official', source_type: 'official', health_status: 'extraction_failed', status: 'error', entry_status: null });
  assert.equal(companyWatchState(company, [official, target()], now), 'open');
  assert.equal(companyWatchState(company, [target(), official], now), 'open');
});

test('reservation, closed and unavailable remain monitoring; state transitions use current data', () => {
  for (const entry_status of ['reservation', 'closed', 'unavailable'] as const) {
    assert.equal(companyWatchState(company, [target({ entry_status })], now), 'monitoring');
  }
  const source = target({ entry_status: 'reservation' });
  assert.equal(companyWatchState(company, [source], now), 'monitoring');
  source.entry_status = 'open';
  assert.equal(companyWatchState(company, [source], now), 'open');
  source.entry_status = 'closed';
  assert.equal(companyWatchState(company, [source], now), 'monitoring');
});

test('old, missing and invalid detection timestamps cannot retain an open label', () => {
  const source = target({ entry_last_checked_at: new Date(now - ENTRY_STATUS_MAX_AGE_MS).toISOString() });
  assert.equal(companyWatchState(company, [source], now), 'open');
  assert.equal(companyWatchState(company, [source], now + 1), 'review');
  for (const entry_last_checked_at of [null, 'invalid', new Date(now + 6 * 60 * 1000).toISOString()]) {
    assert.equal(companyWatchState(company, [target({ entry_last_checked_at })], now), 'review');
  }
});

test('Entry links must belong to the same MyNavi company and graduate year', () => {
  for (const entry_url of [null, 'https://other.example/entry', 'https://job.mynavi.jp/28/pc/corp200002/list.html', 'https://job.mynavi.jp/27/pc/corp100001/list.html', 'https://job.mynavi.jp/28/pc/corp100001/reserve', 'javascript:alert(1)']) {
    assert.equal(companyWatchState(company, [target({ entry_url })], now), 'review');
  }
  assert.equal(companyWatchState(company, [target({ entry_signal: null })], now), 'review');
});

test('non-MyNavi sources cannot imply a confirmed MyNavi Entry opening', () => {
  assert.equal(companyWatchState(company, [target({ source_type: 'official' })], now), 'monitoring');
});

test('disabled MyNavi open cannot override an enabled source', () => {
  assert.equal(companyWatchState(company, [target({ enabled: 0 }), target({ id: 'official', source_type: 'official' })], now), 'monitoring');
});

test('Japanese and Simplified Chinese labels match the requested state semantics', () => {
  assert.equal(watchText.ja.entryOpen, 'エントリー受付中');
  assert.equal(watchText.ja.monitoringNeedsReview, '監視中・要確認');
  assert.equal(watchText.zh.entryOpen, '报名已开放');
  assert.equal(watchText.zh.monitoringNeedsReview, '监控中・需确认');
  assert.equal(currentMynaviEntryStatus(target({ enabled: 0 }), company.name, now), 'needs_review');
});
