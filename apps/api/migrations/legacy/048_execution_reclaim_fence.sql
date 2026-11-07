ALTER TABLE execution_jobs ADD COLUMN sandbox_scope text;

-- A stale binary must not replace or finalize an expired attempt without confirmed teardown.
CREATE FUNCTION guard_expired_attempt_reclaim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN
  NEW.sandbox_scope := NULLIF(current_setting('quorem.sandbox_scope', true), '');
 END IF;
 IF OLD.attempt_id IS NOT NULL AND OLD.lease_until < clock_timestamp()
    AND ((NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)
         OR (NEW.finished AND NOT OLD.finished AND NEW.attempt_id IS NULL))
    AND current_setting('quorem.reaped_attempt', true) IS DISTINCT FROM OLD.attempt_id::text THEN
  RAISE EXCEPTION 'expired attempt teardown required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_reclaim_guard BEFORE UPDATE OF attempt_id ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION guard_expired_attempt_reclaim();
