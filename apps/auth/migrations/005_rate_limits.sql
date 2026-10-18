CREATE TABLE IF NOT EXISTS quorem_auth.rate_limit (
  bucket text PRIMARY KEY,
  used integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_expiry ON quorem_auth.rate_limit(expires_at);
