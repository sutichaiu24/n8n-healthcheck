CREATE TABLE IF NOT EXISTS latest_health (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  credential_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_login_limits (
  ip_hash TEXT PRIMARY KEY,
  bucket INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

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
