CREATE TABLE submission_outbox (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX submission_outbox_pending ON submission_outbox(sequence) WHERE published_at IS NULL;

-- Database state remains authoritative; notifications contain no result or source.
CREATE FUNCTION queue_submission_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.result IS DISTINCT FROM OLD.result OR NEW.cancel_requested IS DISTINCT FROM OLD.cancel_requested THEN
    INSERT INTO submission_outbox(submission_id) VALUES (NEW.id);
    PERFORM pg_notify('quorem_submission_outbox', '');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_notice AFTER INSERT OR UPDATE OF state, result, cancel_requested ON submissions
FOR EACH ROW EXECUTE FUNCTION queue_submission_notice();
