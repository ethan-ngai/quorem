CREATE TABLE IF NOT EXISTS realtime_presence_leases (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (length(topic) <= 128 AND length(subject) <= 128)
);
CREATE INDEX IF NOT EXISTS realtime_presence_subject ON realtime_presence_leases(topic,subject,expires_at);
CREATE INDEX IF NOT EXISTS realtime_presence_expiry ON realtime_presence_leases(expires_at);

CREATE OR REPLACE FUNCTION notify_match_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_match_outbox','');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS match_outbox_notification ON match_outbox;
CREATE TRIGGER match_outbox_notification AFTER INSERT ON match_outbox
FOR EACH STATEMENT EXECUTE FUNCTION notify_match_outbox();

CREATE TABLE IF NOT EXISTS maintenance_schedule (
  task text PRIMARY KEY,
  next_run_at timestamptz NOT NULL
);
