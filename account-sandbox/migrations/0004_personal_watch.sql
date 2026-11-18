-- LOCAL ONLY. Canonical source identity is shared while subscriptions and read state are owner-scoped.
CREATE TABLE account_watch_sources (
  source_key TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('mynavi','official','other')),
  normalized_url TEXT NOT NULL,
  url TEXT NOT NULL,
  runner_state TEXT NOT NULL DEFAULT 'not_connected' CHECK(runner_state IN ('not_connected','ready')),
  created_at TEXT NOT NULL,
  UNIQUE(source_type,normalized_url)
);
CREATE TABLE account_watch_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  source_key TEXT NOT NULL REFERENCES account_watch_sources(source_key),
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(user_id,company_id,source_key)
);
CREATE INDEX account_watch_subscriptions_owner ON account_watch_subscriptions(user_id,enabled,created_at DESC);
CREATE TABLE account_watch_events (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES account_watch_sources(source_key),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  UNIQUE(source_key,content_hash,event_type)
);
CREATE TABLE account_watch_event_deliveries (
  user_id TEXT NOT NULL REFERENCES users(id),
  subscription_id TEXT NOT NULL REFERENCES account_watch_subscriptions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES account_watch_events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,subscription_id,event_id)
);
CREATE INDEX account_watch_deliveries_owner ON account_watch_event_deliveries(user_id,event_id);
CREATE TABLE account_watch_event_reads (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES account_watch_events(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY(user_id,event_id)
);
