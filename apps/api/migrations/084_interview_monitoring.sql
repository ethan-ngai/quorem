ALTER TABLE interviews ADD COLUMN monitoring jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(monitoring)='object');
CREATE TABLE interview_rule_events (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('paste','focus')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX interview_rule_events_recent ON interview_rule_events(session_id,occurred_at DESC,id DESC);
CREATE INDEX interview_rule_events_actor ON interview_rule_events(session_id,owner_id,kind,occurred_at DESC);
