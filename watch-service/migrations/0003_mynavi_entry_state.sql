ALTER TABLE watch_targets ADD COLUMN entry_status TEXT;
ALTER TABLE watch_targets ADD COLUMN entry_status_changed_at TEXT;
ALTER TABLE watch_targets ADD COLUMN entry_last_checked_at TEXT;
ALTER TABLE watch_targets ADD COLUMN entry_url TEXT;
ALTER TABLE watch_targets ADD COLUMN entry_signal TEXT;

CREATE INDEX idx_watch_targets_mynavi_entry ON watch_targets(source_type, entry_status, enabled);
