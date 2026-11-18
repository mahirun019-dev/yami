-- LOCAL ONLY. No bindings or relationships to monitoring or billing databases.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
  subject TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  UNIQUE(issuer, subject)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_transactions (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_expiry ON login_transactions(expires_at);
