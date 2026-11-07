ALTER TABLE submissions ADD COLUMN result_payload bytea;
ALTER TABLE interview_execution ADD COLUMN private_results_payload bytea;

CREATE OR REPLACE FUNCTION immutable_interview_execution_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['private_results','private_results_payload']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['private_results','private_results_payload']) THEN
  RAISE EXCEPTION 'Interview execution context is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Older cleanup binaries clear result; keep both opaque payloads on the same retention boundary.
CREATE FUNCTION clear_submission_result_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.result IS NULL OR current_setting('quorem.lossless_result_write',true) IS DISTINCT FROM 'v1' THEN
  NEW.result_payload := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submission_result_payload_retention BEFORE UPDATE OF result ON submissions
 FOR EACH ROW EXECUTE FUNCTION clear_submission_result_payload();

CREATE FUNCTION clear_interview_result_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.result IS NOT NULL AND NEW.result IS NULL THEN
  UPDATE interview_execution SET private_results=NULL,private_results_payload=NULL WHERE submission_id=NEW.id AND (private_results IS NOT NULL OR private_results_payload IS NOT NULL);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER interview_result_payload_retention AFTER UPDATE OF result ON submissions
 FOR EACH ROW EXECUTE FUNCTION clear_interview_result_payload();

CREATE FUNCTION clear_legacy_private_result_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.private_results IS NULL OR current_setting('quorem.lossless_result_write',true) IS DISTINCT FROM 'v1' THEN
  NEW.private_results_payload := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER interview_private_result_payload_consistency BEFORE UPDATE OF private_results ON interview_execution
 FOR EACH ROW EXECUTE FUNCTION clear_legacy_private_result_payload();
