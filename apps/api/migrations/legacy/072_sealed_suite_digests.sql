-- Digest is computed once as immutable admitted inputs seal.
CREATE TABLE runner_job_input_digests (
 job_id uuid PRIMARY KEY REFERENCES runner_job_inputs(job_id) ON DELETE CASCADE,
 digest bytea NOT NULL CHECK (octet_length(digest)=32)
);
INSERT INTO runner_job_input_digests(job_id,digest)
 SELECT job_id,quorem_suite_digest(job_id) FROM runner_job_inputs WHERE sealed;
CREATE FUNCTION runner_job_input_digest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=NEW.job_id AND sealed)
     OR NEW.digest IS DISTINCT FROM quorem_suite_digest(NEW.job_id) THEN
   RAISE EXCEPTION 'invalid sealed suite digest';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM runner_job_inputs WHERE job_id=OLD.job_id) THEN
  RAISE EXCEPTION 'sealed suite digest is immutable';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER runner_job_input_digests_guard BEFORE INSERT OR UPDATE OR DELETE ON runner_job_input_digests FOR EACH ROW EXECUTE FUNCTION runner_job_input_digest_guard();
CREATE FUNCTION seal_runner_job_input_digest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO runner_job_input_digests(job_id,digest) VALUES(NEW.job_id,quorem_suite_digest(NEW.job_id));
 RETURN NEW;
END $$;
CREATE TRIGGER runner_job_input_digest_seal AFTER UPDATE OF sealed ON runner_job_inputs FOR EACH ROW WHEN (NOT OLD.sealed AND NEW.sealed) EXECUTE FUNCTION seal_runner_job_input_digest();
