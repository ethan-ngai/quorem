CREATE TABLE IF NOT EXISTS quorem_auth.session_assurance (
 session_id text PRIMARY KEY REFERENCES quorem_auth."session"(id) ON DELETE CASCADE,
 strong_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
