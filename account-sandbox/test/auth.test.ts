import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import * as oidc from 'openid-client';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { CALLBACK, FLOW_COOKIE, GOOGLE_ISSUER, LOCAL_ORIGIN, SESSION_COOKIE, beginFlow, consumeFlow, cookie, currentSession, establishSession, hash, opaque, type Flow, type GooglePort, type VerifiedIdentity } from '../src/auth.ts';
import { createHandler, type Env } from '../src/index.ts';
import { portFromConfiguration } from '../src/google.ts';

let mf: Miniflare, db: D1Database, env: Env;
const identity = (subject = 'google-test-subject-A', email = 'fixture@example.com'): VerifiedIdentity => ({ issuer: GOOGLE_ISSUER, subject, email, emailVerified: true });
class FakeGoogle implements GooglePort {
  claims = identity(); failure = false; exchanges = 0;
  async authorization(state: string, nonce: string) { const url = new URL('https://accounts.google.com/o/oauth2/v2/auth'); url.searchParams.set('state', state); url.searchParams.set('nonce', nonce); return url.href; }
  async exchange() { this.exchanges++; if (this.failure) throw new Error('sensitive synthetic upstream contents'); return this.claims; }
}
let provider: FakeGoogle;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("test only")}}', compatibilityDate: '2026-10-30', d1Databases: { ACCOUNT_DB: 'local-google-auth-tests' } }));
  db = await mf.getD1Database('ACCOUNT_DB') as unknown as D1Database;
  const schema = readFileSync(new URL('../migrations/0001_local_accounts.sql', import.meta.url), 'utf8');
  await db.batch(schema.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
});
beforeEach(async () => {
  await db.batch(['DELETE FROM login_transactions', 'DELETE FROM sessions', 'DELETE FROM users'].map(sql => db.prepare(sql)));
  provider = new FakeGoogle();
  env = { AUTH_ENV: 'local-google-test', GOOGLE_CLIENT_ID: 'fixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'unit-test-only', ACCOUNT_DB: db, ASSETS: { fetch: async () => new Response('local page') } as unknown as Fetcher };
});
after(async () => { await mf?.dispose(); });
const cookiePair = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))!.split(';')[0];
test('the integrated sign-in destination is fixed locally, never an arbitrary redirect',async()=>{
  const response=await call('/auth/google/start?app=1&returnTo=https://evil.example','POST');
  const target=await response.json() as {url:string};
  const cookies=[cookiePair(response,FLOW_COOKIE),cookiePair(response,'yami_local_google_destination')].join('; ');
  const state=new URL(target.url).searchParams.get('state');
  const done=await call(`/auth/google/callback?state=${state}&code=test-code`,'GET',cookies);
  assert.equal(done.headers.get('location'),'/app/');
});
test('a stale page cannot log out a different asserted account',async()=>{
  const logged=await login();
  const result=await createHandler(async()=>provider)(new Request(LOCAL_ORIGIN+'/auth/logout',{method:'POST',headers:{cookie:logged.session,origin:LOCAL_ORIGIN,'x-yami-user':'not-the-current-user'},body:'{}'}),env);
  assert.equal(result.status,409);assert.equal((await(await call('/api/session','GET',logged.session)).json() as any).authenticated,true);
});
async function call(path: string, method = 'GET', cookies = '', body = '{}', origin = LOCAL_ORIGIN) {
  return createHandler(async () => provider)(new Request(`${LOCAL_ORIGIN}${path}`, { method, headers: { origin, cookie: cookies, 'content-type': 'application/json' }, ...(method === 'POST' ? { body } : {}) }), env);
}
async function start() {
  const response = await call('/auth/google/start', 'POST');
  const data = await response.json() as { url: string };
  return { state: new URL(data.url).searchParams.get('state')!, cookie: cookiePair(response, FLOW_COOKIE) };
}
async function login(oldSession = '') {
  const flow = await start();
  const response = await call(`/auth/google/callback?state=${flow.state}&code=unit-code`, 'GET', [flow.cookie, oldSession].filter(Boolean).join('; '));
  return { response, session: cookiePair(response, SESSION_COOKIE) };
}
test('unconfigured endpoint reports no authenticated identity and refuses login', async () => {
  env.GOOGLE_CLIENT_ID = undefined; env.GOOGLE_CLIENT_SECRET = undefined;
  const handler = createHandler();
  const info = await (await handler(new Request(`${LOCAL_ORIGIN}/api/session`), env)).json() as { configured: boolean; authenticated: boolean };
  assert.equal(info.configured, false); assert.equal(info.authenticated, false);
  const response = await handler(new Request(`${LOCAL_ORIGIN}/auth/google/start`, { method: 'POST', headers: { origin: LOCAL_ORIGIN } }), env);
  assert.equal(response.status, 503);
});
test('public hosts and production environment are refused', async () => {
  assert.equal((await createHandler()(new Request('https://example.com/api/session'), env)).status, 403);
  env.AUTH_ENV = 'production'; assert.equal((await call('/api/session')).status, 403);
});
test('mutations require exact same-origin and reject client-provided identity data', async () => {
  assert.equal((await call('/auth/google/start', 'POST', '', '{}', 'https://evil.example')).status, 403);
  assert.equal((await call('/auth/google/start', 'POST', '', JSON.stringify({ userId: 'someone', email: 'admin@example.com' }))).status, 400);
});
test('flow values are random, short-lived and browser-bound', async () => {
  const a = await beginFlow(db, null), b = await beginFlow(db, null);
  assert.notEqual(a.state, b.state); assert.notEqual(a.browser, b.browser); assert.notEqual(a.flow.nonce, b.flow.nonce);
  await assert.rejects(consumeFlow(db, a.state, b.browser), /INVALID_LOGIN_FLOW/);
  assert.equal((await consumeFlow(db, a.state, a.browser)).verifier, a.flow.verifier);
  await assert.rejects(consumeFlow(db, a.state, a.browser), /INVALID_LOGIN_FLOW/);
});
test('expired flow and concurrent callback replay cannot succeed twice', async () => {
  const expired = await beginFlow(db, null);
  await db.prepare('UPDATE login_transactions SET expires_at=0').run();
  await assert.rejects(consumeFlow(db, expired.state, expired.browser), /INVALID_LOGIN_FLOW/);
  const flow = await beginFlow(db, null);
  const attempts = await Promise.allSettled([consumeFlow(db, flow.state, flow.browser), consumeFlow(db, flow.state, flow.browser)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
});
test('login establishes an HttpOnly session with hash-only database storage', async () => {
  const result = await login(); assert.equal(result.response.status, 303); assert.equal(result.response.headers.get('location'), '/');
  const header = result.response.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`))!;
  assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Path=\//); assert.match(header, /Max-Age=86400/);
  const record = await db.prepare('SELECT * FROM sessions').first<{ token_hash: string }>();
  assert.equal(record!.token_hash, await hash(result.session.split('=')[1]));
  assert.notEqual(record!.token_hash, result.session.split('=')[1]);
  const status = await (await call('/api/session', 'GET', result.session)).json() as { authenticated: boolean; user: { userId: string } };
  assert.equal(status.authenticated, true); assert.ok(status.user.userId);
});
test('stable issuer/sub retains user ID while verified email can change', async () => {
  const first = await establishSession(db, identity(), null);
  const second = await establishSession(db, identity('google-test-subject-A', 'changed@example.com'), null);
  assert.equal(first.userId, second.userId);
  assert.equal((await currentSession(db, second.raw))!.email, 'changed@example.com');
});
test('the same email does not merge different Google subjects', async () => {
  const a = await establishSession(db, identity('subject-A'), null), b = await establishSession(db, identity('subject-B'), null);
  assert.notEqual(a.userId, b.userId);
  assert.equal((await currentSession(db, a.raw))!.userId, a.userId);
  assert.equal((await currentSession(db, b.raw))!.userId, b.userId);
});
test('reauthentication rotates and invalidates the previous session', async () => {
  const first = await login(); const second = await login(first.session);
  assert.notEqual(first.session, second.session);
  assert.equal((await (await call('/api/session', 'GET', first.session)).json() as { authenticated: boolean }).authenticated, false);
  assert.equal((await (await call('/api/session', 'GET', second.session)).json() as { authenticated: boolean }).authenticated, true);
});
test('logout revokes only the current browser session and its pending flow', async () => {
  const first = await login(); const other = await login(); const pending = await start();
  const result = await call('/auth/logout', 'POST', `${first.session}; ${pending.cookie}`);
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal((await (await call('/api/session', 'GET', first.session)).json() as { authenticated: boolean }).authenticated, false);
  assert.equal((await (await call('/api/session', 'GET', other.session)).json() as { authenticated: boolean }).authenticated, true);
  const callback = await call(`/auth/google/callback?state=${pending.state}&code=unit-code`, 'GET', pending.cookie);
  assert.equal(callback.headers.get('location'), '/?auth_error=signin_failed');
});
test('expired sessions, forged cookies and duplicate cookie names do not authenticate', async () => {
  const first = await establishSession(db, identity(), null);
  await db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal(await currentSession(db, first.raw), null);
  assert.equal(await currentSession(db, opaque()), null);
  const duplicate = new Request(LOCAL_ORIGIN, { headers: { cookie: `${SESSION_COOKIE}=${first.raw}; ${SESSION_COOKIE}=${opaque()}` } });
  assert.equal(cookie(duplicate, SESSION_COOKIE), null);
});
test('bad state, missing code, denied consent and upstream errors never establish a session', async () => {
  const flow = await start();
  const bad = await call(`/auth/google/callback?state=${opaque()}&code=unit`, 'GET', flow.cookie);
  assert.equal(bad.headers.get('location'), '/?auth_error=signin_failed');
  const denied = await call(`/auth/google/callback?state=${flow.state}&error=access_denied`, 'GET', flow.cookie);
  assert.equal(denied.headers.get('location'), '/?auth_error=declined');
  assert.equal(provider.exchanges, 0);
  const again = await start(); provider.failure = true;
  const failed = await call(`/auth/google/callback?state=${again.state}&code=unit`, 'GET', again.cookie);
  assert.equal(failed.headers.get('location'), '/?auth_error=signin_failed');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n, 0);
});
test('callback removes auth code from the destination and refuses duplicate state parameters', async () => {
  const flow = await start();
  const result = await call(`/auth/google/callback?state=${flow.state}&state=${flow.state}&code=private-code`, 'GET', flow.cookie);
  assert.equal(result.headers.get('location'), '/?auth_error=signin_failed');
  assert.doesNotMatch(result.headers.get('location')!, /private-code/);
  assert.equal(provider.exchanges, 0);
});

const clientId = 'fixture.apps.googleusercontent.com';
const metadata = { issuer: GOOGLE_ISSUER, authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs', id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'] };
async function oidcFixture(overrides: Record<string, unknown> = {}, wrongKey = false) {
  const keys = await generateKeyPair('RS256');
  const signKeys = wrongKey ? await generateKeyPair('RS256') : keys;
  const nonce = opaque(), state = opaque(), verifier = opaque();
  const claims = { iss: GOOGLE_ISSUER, aud: clientId, sub: 'verified-google-fixture', nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, email: 'verified-fixture@example.com', email_verified: true, ...overrides };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(signKeys.privateKey);
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  const config = new oidc.Configuration(metadata, clientId, 'unit-test-client-secret');
  config[oidc.customFetch] = async (url, options) => {
    if (String(url) === metadata.token_endpoint) {
      const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get('code_verifier'), verifier); assert.equal(body.get('redirect_uri'), CALLBACK);
      return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'unit-access-token', expires_in: 300, id_token: token }), { headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === metadata.jwks_uri) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
    throw new Error('No external network permitted in fixtures');
  };
  const port = portFromConfiguration(config);
  return { port, state, nonce, verifier, flow: { verifier, nonce, state_hash: '', browser_hash: '', expires_at: Date.now() + 10000 } as Flow, url: new URL(`${CALLBACK}?code=fixture-code&state=${state}`) };
}
test('real OIDC library uses S256 PKCE, fixed callback, state, nonce and minimum scopes', async () => {
  const f = await oidcFixture(); const url = new URL(await f.port.authorization(f.state, f.nonce, f.verifier));
  assert.equal(url.origin, GOOGLE_ISSUER); assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK); assert.equal(url.searchParams.get('nonce'), f.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('code_challenge'), await oidc.calculatePKCECodeChallenge(f.verifier));
});
test('real OIDC library validates the JWT and maps only verified claims', async () => {
  const f = await oidcFixture();
  assert.deepEqual(await f.port.exchange(f.url, f.state, f.flow), identity('verified-google-fixture', 'verified-fixture@example.com'));
});
for (const [name, overrides, wrongKey] of [
  ['invalid signature', {}, true], ['wrong audience', { aud: 'other-client' }, false],
  ['wrong issuer', { iss: 'https://attacker.example' }, false], ['expired token', { exp: 1 }, false],
  ['wrong nonce', { nonce: 'wrong-nonce' }, false], ['unverified email', { email_verified: false }, false],
  ['wrong authorized party', { azp: 'other-client' }, false],
] as const) test(`real Google adapter rejects ${name}`, async () => {
  const f = await oidcFixture(overrides, wrongKey); await assert.rejects(f.port.exchange(f.url, f.state, f.flow));
});
test('real adapter refuses wrong state before token exchange', async () => {
  const f = await oidcFixture(); await assert.rejects(f.port.exchange(f.url, 'different-state', f.flow));
});
test('the prototype cannot use non-Google OIDC endpoints or production billing/data', () => {
  assert.throws(() => portFromConfiguration(new oidc.Configuration({ ...metadata, token_endpoint: 'https://attacker.example/token' }, clientId)), /UNEXPECTED_OIDC_ENDPOINT/);
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.|watch_targets|watch_events|stripe|billing_identity|localStorage/);
  const ui = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /localStorage|sessionStorage|GOOGLE_CLIENT_SECRET|innerHTML/);
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /careerflow-watch|4ab27a5d/);
  assert.deepEqual(JSON.parse(config).triggers.crons,['17 */6 * * *']);
  assert.ok(JSON.parse(config).d1_databases.every((binding:{database_id:string})=>binding.database_id.startsWith('00000000-')));
});
