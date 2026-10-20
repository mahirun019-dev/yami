import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { aboutBuildMetadata } from '../build/aboutMetadata.ts';
import { appReleaseInfo, formatReleaseDate, isOfficialVersion, releaseHistory, type ReleaseRecord } from '../src/about/releases.ts';
import { aboutCopy } from '../src/about/i18n.ts';
import { PRODUCT_UPDATES } from '../src/watch/productUpdates.ts';

const record = (id: string, date: string, version?: string): ReleaseRecord => ({
  id, date, version, title: { ja: id, zh: id }, summary: { ja: id, zh: id }, changes: { ja: [id], zh: [id] },
});

test('no formal release never fabricates a package or commit-derived version', () => {
  assert.deepEqual(appReleaseInfo([]), { version: null, releasedOn: null, updatedOn: null });
  assert.deepEqual(appReleaseInfo([record('legacy', '2026-09-22')]), { version: null, releasedOn: null, updatedOn: '2026-09-22' });
});

test('only explicitly recorded stable semantic versions qualify', () => {
  for (const version of ['1.0.0', '1.12.3', '2.0.0']) assert.ok(isOfficialVersion(version));
  for (const version of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta.1', '', undefined]) assert.equal(isOfficialVersion(version), false);
});

test('ordinary later updates do not automatically increment the formal version', () => {
  assert.deepEqual(appReleaseInfo([record('formal', '2026-10-20', '1.2.0'), record('later', '2026-10-21')]), {
    version: '1.2.0', releasedOn: '2026-10-20', updatedOn: '2026-10-21',
  });
});

test('release history is newest-first, deduplicated and does not mutate records', () => {
  const records = [record('a', '2026-09-20'), record('b', '2026-10-20'), record('a', '2026-09-22'), record('invalid', 'bad-date')];
  const before = JSON.stringify(records);
  assert.deepEqual(releaseHistory(records).map((value) => value.id), ['b', 'a']);
  assert.equal(releaseHistory(records)[1].version, undefined);
  assert.equal(JSON.stringify(records), before);
});

test('release dates show a real date without fabricated hours', () => {
  assert.equal(formatReleaseDate('2026-10-20', 'ja'), '2026/10/20');
  assert.equal(formatReleaseDate('2026-10-20', 'zh'), '2026/10/20');
  assert.equal(formatReleaseDate(null, 'ja'), '—');
  assert.equal(formatReleaseDate('invalid', 'zh'), '—');
});

test('About copy covers both locales with matching keys and accurate service names', () => {
  assert.deepEqual(Object.keys(aboutCopy.ja), Object.keys(aboutCopy.zh));
  for (const copy of Object.values(aboutCopy)) {
    assert.match(copy.localBody, /localStorage/);
    assert.match(copy.localBody, /IndexedDB/);
    assert.match(copy.serverBody, /Cloudflare Worker/);
    assert.match(copy.serverBody, /D1/);
    assert.match(copy.externalBody, /Open-Meteo/);
    assert.match(copy.externalBody, /Nominatim/);
    assert.match(copy.backupBody, /5/);
    assert.match(copy.backupBody, /IndexedDB/);
    assert.ok(copy.noLicense);
  }
});

test('the About release uses the existing bilingual product notification records', () => {
  const announcement = PRODUCT_UPDATES.find((update) => update.id === '2026-10-20-yami-about-and-release-information');
  assert.ok(announcement);
  assert.equal(announcement.version, undefined);
  assert.equal(announcement.date, '2026-10-20');
  assert.ok(announcement.changes.ja.length && announcement.changes.zh.length);
  assert.equal(releaseHistory(PRODUCT_UPDATES)[0].id, announcement.id);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'yami-about-'));
  for (const name of ['react', 'react-dom', 'lucide-react', '@phosphor-icons/react', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities']) {
    const directory = join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '2.3.4', license: 'MIT' }));
    writeFileSync(join(directory, 'LICENSE'), `Actual license text for ${name}`);
  }
  return root;
}

test('build metadata uses the deployment SHA, reads real dependency licenses and excludes secrets', () => {
  const root = fixture();
  try {
    const metadata = aboutBuildMetadata(root, { GITHUB_SHA: 'a'.repeat(40), API_TOKEN: 'not-for-the-client' });
    assert.equal(metadata.commit, 'a'.repeat(40));
    assert.equal(metadata.projectLicense, null);
    assert.equal(metadata.dependencies.length, 7);
    assert.equal(metadata.dependencies[0].text, 'Actual license text for react');
    assert.ok(!JSON.stringify(metadata).includes('not-for-the-client'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing or invalid build metadata has an honest fallback, not version 1.0', () => {
  const root = fixture();
  try {
    assert.equal(aboutBuildMetadata(root, {}).commit, null);
    assert.equal(aboutBuildMetadata(root, { GITHUB_SHA: 'not-a-sha' }).commit, null);
    writeFileSync(join(root, 'LICENSE'), 'Explicit project license content');
    assert.deepEqual(aboutBuildMetadata(root, {}).projectLicense, { filename: 'LICENSE', text: 'Explicit project license content' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
