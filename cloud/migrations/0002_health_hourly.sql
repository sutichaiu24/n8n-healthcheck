CREATE TABLE IF NOT EXISTS health_hourly (
  hour_start TEXT NOT NULL,
  check_id TEXT NOT NULL CHECK (check_id IN ('n8n','workflow','telegram','bot','database','supabase')),
  status TEXT NOT NULL CHECK (status IN ('ok','warn','error','unknown')),
  sample_count INTEGER NOT NULL CHECK (sample_count >= 1),
  first_checked_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  max_gap_seconds INTEGER NOT NULL DEFAULT 0 CHECK (max_gap_seconds >= 0),
  PRIMARY KEY (hour_start, check_id)
);
