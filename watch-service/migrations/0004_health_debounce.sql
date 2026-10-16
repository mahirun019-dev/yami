-- Additive only. Rollback: deploy the previous Worker and leave these unused columns.
ALTER TABLE watch_targets ADD COLUMN transient_failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_targets ADD COLUMN health_failure_run_id TEXT;
ALTER TABLE watch_targets ADD COLUMN health_alerted_at TEXT;
