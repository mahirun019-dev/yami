-- LOCAL ONLY. User-confirmed imports and exact pre-import rollback snapshots.
CREATE TABLE user_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('staging','committed','rolled_back','aborted')),
  expected_revision INTEGER NOT NULL,
  manifest TEXT NOT NULL,
  source_storage TEXT NOT NULL,
  previous_revision INTEGER,
  previous_storage TEXT,
  applied_revision INTEGER,
  created_at TEXT NOT NULL,
  rolled_back_at TEXT
);
CREATE UNIQUE INDEX user_import_active_fingerprint ON user_imports(user_id,fingerprint) WHERE state='committed';
CREATE INDEX user_imports_owner_recent ON user_imports(user_id,created_at DESC);
CREATE TABLE user_import_staged_files (
  user_id TEXT NOT NULL REFERENCES users(id),
  import_id TEXT NOT NULL REFERENCES user_imports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('attachments','backups')),
  id TEXT NOT NULL,
  content BLOB NOT NULL,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY(user_id,import_id,kind,id)
);
CREATE TABLE user_import_snapshot_files (
  user_id TEXT NOT NULL REFERENCES users(id),
  import_id TEXT NOT NULL REFERENCES user_imports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('attachments','backups')),
  id TEXT NOT NULL,
  content BLOB NOT NULL,
  media_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,import_id,kind,id)
);
