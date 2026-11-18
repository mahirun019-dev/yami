-- Additive, LOCAL ONLY. Existing Google identities/sessions remain untouched.
CREATE TABLE user_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  revision INTEGER NOT NULL DEFAULT 0,
  storage TEXT NOT NULL DEFAULT '{"career-flow-demo-cleaned-v1":"1"}',
  updated_at TEXT NOT NULL
);
CREATE TABLE user_files (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('attachments','backups')),
  id TEXT NOT NULL,
  content BLOB NOT NULL,
  media_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,kind,id)
);
