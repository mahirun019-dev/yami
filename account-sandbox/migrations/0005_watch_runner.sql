-- Isolated account emulator only. No production migration.
CREATE TABLE watch_targets (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, company_name TEXT NOT NULL,
 source_type TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
 normalized_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_checked_at TEXT,
 last_success_at TEXT, status TEXT NOT NULL DEFAULT 'paused', last_http_status INTEGER,
 last_hash TEXT, last_error TEXT, snapshot TEXT, lease_until TEXT,
 health_status TEXT, health_checked_at TEXT, health_detail TEXT,
 detected_company_name TEXT, snapshot_url TEXT, snapshot_source_type TEXT,
 entry_status TEXT, entry_status_changed_at TEXT, entry_last_checked_at TEXT,
 entry_url TEXT, entry_signal TEXT, transient_failure_count INTEGER NOT NULL DEFAULT 0,
 health_failure_run_id TEXT, health_alerted_at TEXT
);
CREATE TABLE watch_events (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, company_name TEXT NOT NULL,
 watch_target_id TEXT NOT NULL REFERENCES watch_targets(id), event_type TEXT NOT NULL,
 title TEXT NOT NULL, summary TEXT NOT NULL, before_excerpt TEXT, after_excerpt TEXT,
 detected_at TEXT NOT NULL, source_url TEXT NOT NULL, source_type TEXT NOT NULL,
 read INTEGER NOT NULL DEFAULT 0, content_hash TEXT NOT NULL,
 UNIQUE(watch_target_id,content_hash,event_type)
);
CREATE TABLE account_watch_runs (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL
);
