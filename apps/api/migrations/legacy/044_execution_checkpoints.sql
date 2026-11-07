CREATE TABLE execution_checkpoints (
 job_id uuid PRIMARY KEY REFERENCES execution_jobs(id) ON DELETE CASCADE,
 last_attempt_id uuid,
 next_ordinal integer NOT NULL DEFAULT 0 CHECK (next_ordinal BETWEEN 0 AND 320),
 artifact jsonb,
 compilation_nanos bigint NOT NULL DEFAULT 0 CHECK (compilation_nanos BETWEEN 0 AND 120000000000),
 fatal bytea
);

CREATE TABLE execution_checkpoint_cases (
 job_id uuid NOT NULL REFERENCES execution_checkpoints(job_id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
 frame bytea NOT NULL,
 PRIMARY KEY(job_id,ordinal)
);

-- Reservations bound concurrent guest jobs; metering records actual elapsed chunk time.
ALTER TABLE execution_attempt_usage DROP CONSTRAINT execution_attempt_usage_seconds_check;
ALTER TABLE execution_attempt_usage ADD CONSTRAINT execution_attempt_usage_seconds_check CHECK (seconds >= 0);
ALTER TABLE guest_execution_usage DROP CONSTRAINT guest_execution_usage_charged_seconds_check;
ALTER TABLE guest_execution_usage ADD CONSTRAINT guest_execution_usage_charged_seconds_check CHECK (charged_seconds >= 0);

CREATE OR REPLACE FUNCTION meter_guest_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE elapsed integer; terminal_state text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM guest_execution_usage WHERE submission_id=OLD.submission_id) THEN RETURN NEW; END IF;
 IF OLD.attempt_id IS NOT NULL AND OLD.attempt_started_at IS NOT NULL AND (NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR (NEW.finished AND NOT OLD.finished)) THEN
  elapsed:=GREATEST(0,CEIL(EXTRACT(EPOCH FROM(clock_timestamp()-OLD.attempt_started_at)))::integer);
  INSERT INTO execution_attempt_usage(attempt_id,submission_id,seconds) VALUES(OLD.attempt_id,OLD.submission_id,elapsed) ON CONFLICT DO NOTHING;
 END IF;
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN NEW.attempt_started_at:=CASE WHEN NEW.attempt_id IS NULL THEN NULL ELSE clock_timestamp() END; END IF;
 IF NEW.finished AND NOT OLD.finished THEN
  SELECT state INTO terminal_state FROM submissions WHERE id=NEW.submission_id;
  UPDATE guest_execution_usage SET charged_seconds=CASE WHEN terminal_state='completed' THEN COALESCE((SELECT sum(seconds) FROM execution_attempt_usage WHERE submission_id=NEW.submission_id),0) ELSE 0 END,settled_at=clock_timestamp() WHERE submission_id=NEW.submission_id AND settled_at IS NULL;
 END IF;
 RETURN NEW;
END $$;

-- Old or disabled judges must never claim work that has a resumable prefix.
CREATE FUNCTION guard_checkpoint_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ((NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)
     OR (NEW.finished AND NOT OLD.finished AND NEW.attempt_id IS NULL AND OLD.attempt_id IS NOT NULL AND OLD.attempts>=3
         AND EXISTS(SELECT 1 FROM submissions WHERE id=NEW.submission_id AND NOT cancel_requested)))
    AND EXISTS(SELECT 1 FROM execution_checkpoints WHERE job_id=NEW.id)
    AND current_setting('quorem.checkpoint_claim',true) IS DISTINCT FROM 'v1' THEN
  RAISE EXCEPTION 'checkpoint-capable judge required' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_checkpoint_claim_guard BEFORE UPDATE OF attempt_id ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION guard_checkpoint_claim();

-- Terminal writes from any deployed API or judge release private checkpoint data.
CREATE FUNCTION cleanup_terminal_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.finished AND NOT OLD.finished THEN
  DELETE FROM execution_checkpoints WHERE job_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER execution_checkpoint_terminal_cleanup AFTER UPDATE OF finished ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION cleanup_terminal_checkpoint();
