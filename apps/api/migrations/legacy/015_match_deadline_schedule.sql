-- Wake schedulers only after deadline changes commit; matches remain authoritative.
CREATE FUNCTION notify_match_deadline_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_match_deadlines', '');
  RETURN NULL;
END;
$$;

CREATE TRIGGER match_deadline_schedule
AFTER INSERT OR DELETE OR UPDATE OF state, started_at, deadline, finalizing_at, expires_at ON matches
FOR EACH STATEMENT EXECUTE FUNCTION notify_match_deadline_schedule();

-- Match submission state transitions require reconciliation even before a deadline.
CREATE TABLE match_reconciliation_pending (
  match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  generation bigint NOT NULL DEFAULT 1
);

CREATE FUNCTION queue_match_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_id IS NOT NULL AND NEW.kind = 'submit' AND NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO match_reconciliation_pending(match_id) VALUES (NEW.match_id)
    ON CONFLICT(match_id) DO UPDATE SET generation=match_reconciliation_pending.generation+1;
    PERFORM pg_notify('quorem_match_deadlines', '');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER match_submission_reconciliation AFTER UPDATE OF state ON submissions
FOR EACH ROW EXECUTE FUNCTION queue_match_reconciliation();

CREATE FUNCTION clear_finished_match_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('completed', 'cancelled') THEN
    DELETE FROM match_reconciliation_pending WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finished_match_reconciliation AFTER UPDATE OF state ON matches
FOR EACH ROW EXECUTE FUNCTION clear_finished_match_reconciliation();
