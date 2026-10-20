import type { ProductUpdate } from '../watch/productUpdates';

export type ReleaseRecord = ProductUpdate;

// Only an explicitly recorded stable SemVer is a formal release, never package.json or a commit count.
export function isOfficialVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

export function releaseHistory(records: readonly ReleaseRecord[]) {
  return [...new Map(records.filter((record) => Number.isFinite(Date.parse(record.date))).map((record) => [record.id, record])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function appReleaseInfo(records: readonly ReleaseRecord[]) {
  const history = releaseHistory(records);
  const formal = history.find((record) => isOfficialVersion(record.version));
  return { version: formal?.version ?? null, releasedOn: formal?.date ?? null, updatedOn: history[0]?.date ?? null };
}

export function formatReleaseDate(value: string | null, locale: 'ja' | 'zh') {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}
