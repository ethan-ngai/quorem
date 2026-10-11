CREATE TABLE IF NOT EXISTS cancellation_idempotency (
 owner_id text NOT NULL REFERENCES users(id), key text NOT NULL,
 submission_id uuid NOT NULL REFERENCES submissions(id), response jsonb NOT NULL,
 expires_at timestamptz NOT NULL, PRIMARY KEY(owner_id,key)
);
