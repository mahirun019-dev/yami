-- Additive only: failed access-code attempts for brute-force rate limiting.
-- Rows hold a hashed client key and a timestamp, and are deleted after the 15-minute window.
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  client_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_client ON login_attempts(client_hash, attempted_at);
CREATE INDEX idx_login_attempts_time ON login_attempts(attempted_at);
