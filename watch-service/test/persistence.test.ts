import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { scheduled } from '../src/index';
import type { Env } from '../src/types';

class SQLiteD1 {
  readonly db = new DatabaseSync(':memory:');
  prepare(sql: string) {
    const statement = this.db.prepare(sql); let values: SQLInputValue[] = [];
    return {
      bind(...args: unknown[]) { values = args as SQLInputValue[]; return this; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      async first<T>() { return (statement.get(...values) || null) as T | null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
    };
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.db.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

test('additive migration preserves existing data; real SQLite executes failure debounce and recovery comparison', async () => {
  const db = new SQLiteD1();
  for (const file of ['0001_initial.sql', '0002_source_health.sql', '0003_mynavi_entry_state.sql']) db.db.exec(migration(file));
  db.db.prepare("INSERT INTO watch_targets(id,company_id,company_name,source_type,url,normalized_url,created_at,updated_at,status,health_status) VALUES('source','company','株式会社Aiming','official','https://example.com/recruit/','https://example.com/recruit/','2026-10-01','2026-10-01','active','healthy')").run();
  const before = db.db.prepare('SELECT * FROM watch_targets').get()!;
  db.db.exec(migration('0004_health_debounce.sql'));
  const migrated = db.db.prepare('SELECT * FROM watch_targets').get()!;
  for (const [key, value] of Object.entries(before)) assert.equal(migrated[key], value);
  assert.equal(migrated.transient_failure_count, 0); assert.equal(migrated.health_alerted_at, null);
  const env = { DB: db } as unknown as Env;
  const original = globalThis.fetch; let fail = false; let holiday = 124;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('dns-query')) return Response.json({ Answer: [{ data: '198.51.100.10' }] });
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    if (fail) return new Response('', { status: 503, headers: { 'retry-after': '60' } });
    return new Response(`<main><h1>株式会社Aiming</h1><section><h2>募集要項</h2><p>年間休日${holiday}日</p><p>募集職種はシステムエンジニアです。</p><p>応募資格、勤務地、初任給、福利厚生を掲載しています。</p></section></main>`, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const source = () => db.db.prepare('SELECT * FROM watch_targets').get()!;
  const events = () => db.db.prepare('SELECT * FROM watch_events ORDER BY detected_at').all();
  try {
    await scheduled(env); const baseline = source().snapshot; const hash = source().last_hash;
    assert.ok(baseline); assert.equal(events().length, 0);
    fail = true; await scheduled(env); assert.equal(events().length, 0); assert.equal(source().transient_failure_count, 1);
    await scheduled(env); assert.equal(events().length, 1); assert.equal(source().transient_failure_count, 2); assert.ok(source().health_alerted_at);
    await scheduled(env); assert.equal(events().length, 1); assert.equal(source().snapshot, baseline); assert.equal(source().last_hash, hash);
    fail = false; holiday = 130; await scheduled(env);
    assert.equal(events().length, 2); assert.equal(events()[1].event_type, 'job_info_updated'); assert.equal(source().transient_failure_count, 0); assert.equal(source().health_alerted_at, null);
    await scheduled(env); assert.equal(events().length, 2);
    // Simulate loss of the persistence transaction: neither event nor alert marker may commit.
    fail = true; await scheduled(env);
    db.db.exec("CREATE TRIGGER fail_health_update BEFORE UPDATE OF health_alerted_at ON watch_targets WHEN NEW.health_alerted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test transaction failure'); END;");
    await assert.rejects(scheduled(env), /WATCH_RUN_INCOMPLETE/);
    assert.equal(events().length, 2); assert.equal(source().health_alerted_at, null);
  } finally { globalThis.fetch = original; db.db.close(); }
});
