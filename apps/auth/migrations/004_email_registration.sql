CREATE TABLE IF NOT EXISTS quorem_auth.registration_email (
  email text PRIMARY KEY,
  token_hash text UNIQUE,
  grant_hash text UNIQUE,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_email_expiry ON quorem_auth.registration_email(expires_at);
