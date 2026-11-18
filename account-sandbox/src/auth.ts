export const LOCAL_ORIGIN = 'http://127.0.0.1:8790';
export const CALLBACK = `${LOCAL_ORIGIN}/auth/google/callback`;
export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const SESSION_COOKIE = 'yami_local_google_session';
export const FLOW_COOKIE = 'yami_local_google_flow';
export const SESSION_TTL = 24 * 60 * 60 * 1000;
export const FLOW_TTL = 10 * 60 * 1000;
export class AuthError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export type Flow = { state_hash: string; browser_hash: string; verifier: string; nonce: string; expires_at: number };
export type VerifiedIdentity = { issuer: typeof GOOGLE_ISSUER; subject: string; email: string; emailVerified: true };
export interface GooglePort {
  authorization(state: string, nonce: string, verifier: string): Promise<string>;
  exchange(url: URL, state: string, flow: Flow): Promise<VerifiedIdentity>;
}
export function opaque() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function cookie(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}
export function cookieHeader(name: string, value: string, maxAge: number) {
  // HTTP is allowed only for this exact loopback prototype. Never use these cookies in production.
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export async function beginFlow(db: D1Database, previousBrowser: string | null) {
  const state = opaque(), browser = opaque(), verifier = opaque(), nonce = opaque();
  const now = Date.now();
  const cleanup = [db.prepare('DELETE FROM login_transactions WHERE expires_at<=?').bind(now), db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now)];
  if (previousBrowser) cleanup.push(db.prepare('DELETE FROM login_transactions WHERE browser_hash=?').bind(await hash(previousBrowser)));
  const flow: Flow = { state_hash: await hash(state), browser_hash: await hash(browser), verifier, nonce, expires_at: now + FLOW_TTL };
  await db.batch([...cleanup, db.prepare('INSERT INTO login_transactions(state_hash,browser_hash,verifier,nonce,expires_at) VALUES(?,?,?,?,?)').bind(flow.state_hash, flow.browser_hash, verifier, nonce, flow.expires_at)]);
  return { state, browser, flow };
}
export async function consumeFlow(db: D1Database, state: string | null, browser: string | null) {
  if (!state || !browser || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AuthError('INVALID_LOGIN_FLOW');
  const flow = await db.prepare('DELETE FROM login_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *')
    .bind(await hash(state), await hash(browser), Date.now()).first<Flow>();
  if (!flow) throw new AuthError('INVALID_LOGIN_FLOW');
  return flow;
}
export async function establishSession(db: D1Database, identity: VerifiedIdentity, previousSession: string | null) {
  if (identity.issuer !== GOOGLE_ISSUER || !identity.subject || identity.subject.length > 255 || identity.emailVerified !== true || !identity.email || identity.email.length > 254) throw new AuthError('INVALID_VERIFIED_IDENTITY');
  const now = Date.now();
  const user = await db.prepare('INSERT INTO users(id,issuer,subject,verified_email,created_at,last_login_at) VALUES(?,?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET verified_email=excluded.verified_email,last_login_at=excluded.last_login_at RETURNING id')
    .bind(crypto.randomUUID(), identity.issuer, identity.subject, identity.email, now, now).first<{ id: string }>();
  if (!user) throw new AuthError('SESSION_STORAGE_FAILED', 503);
  const raw = opaque(), expires = now + SESSION_TTL;
  const mutations = [db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await hash(raw), user.id, expires, now)];
  if (previousSession) mutations.push(db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(previousSession)));
  await db.batch(mutations);
  return { raw, expires, userId: user.id };
}
export async function currentSession(db: D1Database, raw: string | null) {
  if (!raw) return null;
  return db.prepare('SELECT users.id AS userId,users.verified_email AS email,sessions.expires_at AS expiresAt FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?')
    .bind(await hash(raw), Date.now()).first<{ userId: string; email: string; expiresAt: number }>();
}
