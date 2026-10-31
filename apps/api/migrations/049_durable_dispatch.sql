-- Existing outboxes remain the notice source; no second emitter.
ALTER TABLE interview_outbox ADD COLUMN dispatch_token uuid, ADD COLUMN dispatch_until timestamptz;
ALTER TABLE match_outbox ADD COLUMN dispatch_token uuid, ADD COLUMN dispatch_until timestamptz;
ALTER TABLE submission_outbox ADD COLUMN dispatch_token uuid, ADD COLUMN dispatch_until timestamptz;
ALTER TABLE membership_outbox ADD COLUMN dispatch_token uuid, ADD COLUMN dispatch_until timestamptz;

-- Insert in the same transaction as the execution admission it wakes.
CREATE TABLE execution_dispatch_intents (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 delivered_at timestamptz,
 dispatch_token uuid,
 dispatch_until timestamptz
);
CREATE INDEX execution_dispatch_pending ON execution_dispatch_intents (available_at, id) WHERE delivered_at IS NULL;
