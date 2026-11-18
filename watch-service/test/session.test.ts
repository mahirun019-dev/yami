import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import worker, { LOGIN_MAX_FAILURES_PER_CLIENT } from '../src/index';
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
}

function database(withLimiter: boolean) {
  const db = new SQLiteD1();
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    if (!withLimiter && file === '0005_login_attempts.sql') continue;
    db.db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  return db;
}

const envFor = (db: SQLiteD1) => ({ DB: db, WATCH_ACCESS_CODE: 'correct-code', ALLOWED_ORIGIN: 'https://careerflow.example' }) as unknown as Env;
const login = (db: SQLiteD1, code: string, ip = '198.51.100.7') => worker.fetch(new Request('https://watch.example/api/session', {
  method: 'POST', headers: { origin: 'https://careerflow.example', 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ code }),
}), envFor(db), { waitUntil() {} } as unknown as ExecutionContext);

test('access-code guessing is limited per client, and a correct code from another client still works', async () => {
  const db = database(true);
  for (let attempt = 0; attempt < LOGIN_MAX_FAILURES_PER_CLIENT; attempt++) assert.equal((await login(db, 'wrong')).status, 401);
  const limited = await login(db, 'correct-code');
  assert.equal(limited.status, 429, 'even the right code waits out the window once the client is limited');
  assert.equal(limited.headers.get('retry-after'), '900');
  assert.equal((await login(db, 'correct-code', '203.0.113.9')).status, 201);
  const stored = db.db.prepare('SELECT client_hash FROM login_attempts LIMIT 1').get() as { client_hash: string };
  assert.doesNotMatch(stored.client_hash, /198\.51/, 'client addresses are stored only as hashes');
});

test('a successful login clears earlier failures and old attempts expire', async () => {
  const db = database(true);
  for (let attempt = 0; attempt < LOGIN_MAX_FAILURES_PER_CLIENT - 1; attempt++) await login(db, 'wrong');
  assert.equal((await login(db, 'correct-code')).status, 201);
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get() as { n: number }).n, 0);
  db.db.prepare('INSERT INTO login_attempts(id,client_hash,attempted_at) VALUES(?,?,?)').run('old', 'x', '2000-01-01T00:00:00.000Z');
  await login(db, 'wrong');
  assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE id='old'").get() as { n: number }).n, 0);
});

test('login keeps working if the limiter migration has not been applied yet', async () => {
  const db = database(false);
  assert.equal((await login(db, 'wrong')).status, 401);
  assert.equal((await login(db, 'correct-code')).status, 201);
});

test('malformed login bodies return 400 instead of throwing', async () => {
  const db = database(true);
  const response = await worker.fetch(new Request('https://watch.example/api/session', { method: 'POST', headers: { origin: 'https://careerflow.example' }, body: '{not json' }), envFor(db), { waitUntil() {} } as unknown as ExecutionContext);
  assert.equal(response.status, 400);
});

const call = (db: SQLiteD1, method: string, path: string, token: string) => worker.fetch(new Request(`https://watch.example${path}`, {
  method, headers: { origin: 'https://careerflow.example', authorization: `Bearer ${token}` },
}), envFor(db), { waitUntil() {} } as unknown as ExecutionContext);

test('disconnecting revokes the server session', async () => {
  const db = database(true);
  const { token } = await (await login(db, 'correct-code')).json() as { token: string };
  assert.equal((await call(db, 'GET', '/api/targets', token)).status, 200);
  assert.equal((await call(db, 'DELETE', '/api/session', token)).status, 200);
  assert.equal((await call(db, 'GET', '/api/targets', token)).status, 401);
});

test('old unread events stay in the feed beyond the latest 100', async () => {
  const db = database(true);
  db.db.prepare("INSERT INTO watch_targets(id,company_id,company_name,source_type,url,normalized_url,created_at,updated_at,status) VALUES('t','c','株式会社Aiming','official','https://example.com/','https://example.com/','2026-01-01','2026-01-01','active')").run();
  const insert = db.db.prepare("INSERT INTO watch_events(id,company_id,company_name,watch_target_id,event_type,title,summary,detected_at,source_url,source_type,read,content_hash) VALUES(?,'c','株式会社Aiming','t','job_info_updated','t','s',?,'https://example.com/','official',?,?)");
  insert.run('old-unread', '2026-01-01T00:00:00.000Z', 0, 'h-old');
  for (let index = 0; index < 120; index++) insert.run(`read-${index}`, `2026-06-01T00:${String(index % 60).padStart(2, '0')}:${String(Math.floor(index / 60)).padStart(2, '0')}.000Z`, 1, `h-${index}`);
  const { token } = await (await login(db, 'correct-code')).json() as { token: string };
  const { events } = await (await call(db, 'GET', '/api/targets', token)).json() as { events: Array<{ id: string }> };
  assert.ok(events.some((event) => event.id === 'old-unread'));
  assert.equal(events.length, 101);
});
