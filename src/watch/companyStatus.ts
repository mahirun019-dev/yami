import type { MynaviEntryStatus, WatchTarget } from './types';

// Two six-hour Cron intervals allow one delayed check without retaining old results indefinitely.
export const ENTRY_STATUS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function companyWatchKey(name: string) {
  return name.normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/(株式会社|有限会社|\(株\)|\(有\))/g, '')
    .replace(/[\s・.．,，、()（）\-]/g, '');
}

function entryCompanyKey(name: string) {
  return companyWatchKey(name.normalize('NFKC').replace(/[【［\[(（][^】］\])）]*(?:グループ|グループ会社)[^】］\])）]*[】］\])）]/g, ''));
}

export function matchesWatchCompany(company: { id: string; name: string }, target: { company_id: string; company_name: string }) {
  return target.company_id === company.id || companyWatchKey(target.company_name) === companyWatchKey(company.name);
}

function freshCheck(value: string | null | undefined, now: number) {
  if (!value) return false;
  const checkedAt = Date.parse(value);
  return Number.isFinite(checkedAt) && checkedAt <= now + 5 * 60 * 1000 && now - checkedAt <= ENTRY_STATUS_MAX_AGE_MS;
}

function companyIdFromUrl(url: URL) {
  return url.pathname.match(/\/corp(\d+)(?:\/|$)/)?.[1] || url.searchParams.get('corpId');
}

export function verifiedEntryUrl(target: WatchTarget): string | null {
  if (!target.entry_url || !target.entry_signal) return null;
  try {
    const source = new URL(target.url), entry = new URL(target.entry_url);
    const companyId = companyIdFromUrl(source);
    const year = source.pathname.match(/^\/(\d{2})\//)?.[1];
    if (source.protocol !== 'https:' || entry.protocol !== 'https:' || source.hostname !== 'job.mynavi.jp' || entry.origin !== source.origin || entry.username || entry.password) return null;
    if (!companyId || companyIdFromUrl(entry) !== companyId || !year || entry.pathname.match(/^\/(\d{2})\//)?.[1] !== year) return null;
    if (/login|signin|reserve|reservation/i.test(entry.pathname)) return null;
    return entry.toString();
  } catch { return null; }
}

export function currentMynaviEntryStatus(target: WatchTarget, companyName: string, now: number): MynaviEntryStatus {
  const identityMatches = Boolean(target.detected_company_name && entryCompanyKey(target.detected_company_name) === entryCompanyKey(companyName));
  if (!target.enabled || target.source_type !== 'mynavi' || target.health_status !== 'healthy' || target.status === 'error' || target.status === 'paused' || target.last_error || !identityMatches || !freshCheck(target.entry_last_checked_at, now)) return 'needs_review';
  if (!target.entry_status || target.entry_status === 'unknown') return 'needs_review';
  if (target.entry_status === 'open' && !verifiedEntryUrl(target)) return 'needs_review';
  return target.entry_status;
}

export function companyWatchState(company: { id: string; name: string }, targets: WatchTarget[], now: number): 'open' | 'monitoring' | 'review' | null {
  const enabled = targets.filter((target) => target.enabled && matchesWatchCompany(company, target));
  if (!enabled.length) return null;
  const mynavi = enabled.filter((target) => target.source_type === 'mynavi');
  if (mynavi.some((target) => currentMynaviEntryStatus(target, company.name, now) === 'open')) return 'open';
  if (mynavi.some((target) => currentMynaviEntryStatus(target, company.name, now) === 'needs_review')) return 'review';
  if (enabled.some((target) => target.health_status && target.health_status !== 'healthy' || target.status === 'error' || target.last_error)) return 'review';
  return 'monitoring';
}
