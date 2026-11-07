-- An execution peer must advertise this exact server-bound protocol inside its claim transaction.
CREATE FUNCTION runner_manifest_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id AND NEW.attempt_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=NEW.id)
    AND current_setting('quorem.runner_input_protocol',true) IS DISTINCT FROM 'manifest-v1' THEN
  RAISE EXCEPTION 'runner input protocol required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runner_manifest_claim_guard BEFORE UPDATE OF attempt_id ON execution_jobs FOR EACH ROW EXECUTE FUNCTION runner_manifest_claim_guard();

CREATE TABLE interview_active_runner_inputs (
 session_id uuid PRIMARY KEY REFERENCES interviews(id) ON DELETE CASCADE,
 question_epoch uuid NOT NULL,
 fixture_id bytea NOT NULL,
 FOREIGN KEY(session_id,fixture_id) REFERENCES runner_snapshot_inputs(session_id,fixture_id)
);
CREATE FUNCTION interview_active_runner_input_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_epoch uuid; input_sealed boolean;
BEGIN
 SELECT question_epoch INTO current_epoch FROM interviews WHERE id=NEW.session_id FOR SHARE;
 SELECT sealed INTO input_sealed FROM runner_snapshot_inputs WHERE session_id=NEW.session_id AND fixture_id=NEW.fixture_id;
 IF current_epoch IS DISTINCT FROM NEW.question_epoch OR input_sealed IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'active runner input is stale or unsealed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER interview_active_runner_input_guard BEFORE INSERT OR UPDATE ON interview_active_runner_inputs FOR EACH ROW EXECUTE FUNCTION interview_active_runner_input_guard();
CREATE FUNCTION interview_clear_stale_runner_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.question_epoch IS DISTINCT FROM NEW.question_epoch THEN
  DELETE FROM interview_active_runner_inputs WHERE session_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER interview_clear_stale_runner_input AFTER UPDATE OF question_epoch ON interviews FOR EACH ROW EXECUTE FUNCTION interview_clear_stale_runner_input();
