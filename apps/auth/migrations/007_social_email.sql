CREATE TABLE IF NOT EXISTS quorem_auth.social_email (
  proof_hash text PRIMARY KEY,
  provider text NOT NULL,
  account_id text NOT NULL,
  email text,
  token_hash text UNIQUE,
  linking boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS social_email_identity ON quorem_auth.social_email(provider, account_id);
