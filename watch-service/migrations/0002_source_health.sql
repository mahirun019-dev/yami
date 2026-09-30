ALTER TABLE watch_targets ADD COLUMN health_status TEXT;
ALTER TABLE watch_targets ADD COLUMN health_checked_at TEXT;
ALTER TABLE watch_targets ADD COLUMN health_detail TEXT;
ALTER TABLE watch_targets ADD COLUMN detected_company_name TEXT;
ALTER TABLE watch_targets ADD COLUMN snapshot_url TEXT;
ALTER TABLE watch_targets ADD COLUMN snapshot_source_type TEXT;

UPDATE watch_targets
SET snapshot_url = normalized_url,
    snapshot_source_type = source_type
WHERE snapshot IS NOT NULL;

CREATE INDEX idx_watch_targets_health ON watch_targets(enabled, health_status);
