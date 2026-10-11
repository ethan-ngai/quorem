CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 kind text NOT NULL CHECK(kind IN ('run','submit')), source text NOT NULL, source_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','completed','cancelled','failed')),
 cases jsonb NOT NULL, result jsonb, cancel_requested boolean NOT NULL DEFAULT false,
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_busy ON submissions(owner_id) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS submission_quota ON submissions(owner_id,admitted_at DESC);
CREATE TABLE IF NOT EXISTS execution_jobs (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id),
 attempt_id uuid, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_until timestamptz,
 finished boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS jobs_claim ON execution_jobs(available_at) WHERE NOT finished;
CREATE TABLE IF NOT EXISTS execution_idempotency (
 owner_id text NOT NULL REFERENCES users(id), key text NOT NULL, body_hash text NOT NULL,
 submission_id uuid NOT NULL REFERENCES submissions(id), expires_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,key)
);
CREATE TABLE IF NOT EXISTS outbox_events (
 id uuid PRIMARY KEY, aggregate_id uuid NOT NULL, type text NOT NULL,
 schema_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
