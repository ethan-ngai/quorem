-- Input roots may only disappear through retention of their owning domain record.
CREATE FUNCTION runner_input_root_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='runner_job_inputs' THEN
  IF EXISTS(SELECT 1 FROM execution_jobs WHERE id=OLD.job_id) THEN RAISE EXCEPTION 'runner job input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_version_inputs' THEN
  IF EXISTS(SELECT 1 FROM problem_versions WHERE id=OLD.version_id) THEN RAISE EXCEPTION 'runner version input is retained'; END IF;
 ELSIF TG_TABLE_NAME='runner_snapshot_inputs' THEN
  IF EXISTS(SELECT 1 FROM interview_question_snapshots WHERE session_id=OLD.session_id AND id=OLD.fixture_id) THEN RAISE EXCEPTION 'runner snapshot input is retained'; END IF;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER runner_job_input_delete_guard BEFORE DELETE ON runner_job_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_root_delete_guard();
CREATE TRIGGER runner_version_input_delete_guard BEFORE DELETE ON runner_version_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_root_delete_guard();
CREATE TRIGGER runner_snapshot_input_delete_guard BEFORE DELETE ON runner_snapshot_inputs FOR EACH ROW EXECUTE FUNCTION runner_input_root_delete_guard();
