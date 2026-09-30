export type SourceType = "mynavi" | "official" | "other";
export type WatchStatus = "active" | "checking" | "error" | "paused";
export type SourceHealthStatus = "healthy" | "identity_mismatch" | "extraction_failed" | "unreachable" | "auth_required" | "source_changed" | "needs_review";
export type EventType = "entry_open" | "briefing_open" | "internship_open" | "deadline_changed" | "selection_updated" | "job_info_updated" | "recruitment_closed" | "other_recruitment_update" | "source_health_issue" | "source_health_recovered";

export interface Env {
  DB: D1Database;
  WATCH_ACCESS_CODE: string;
  ALLOWED_ORIGIN: string;
}

export interface TargetRow {
  id: string;
  company_id: string;
  company_name: string;
  source_type: SourceType;
  label: string;
  url: string;
  normalized_url: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  status: WatchStatus;
  last_http_status: number | null;
  last_hash: string | null;
  last_error: string | null;
  snapshot: string | null;
  snapshot_url?: string | null;
  snapshot_source_type?: SourceType | null;
  health_status?: SourceHealthStatus | null;
  health_checked_at?: string | null;
  health_detail?: string | null;
  detected_company_name?: string | null;
  lease_until: string | null;
}
