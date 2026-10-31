-- Staging belongs to one fenced attempt and is independent of resumable checkpoints.
CREATE TABLE execution_completion_staging (
 job_id uuid PRIMARY KEY REFERENCES execution_jobs(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 sandbox_scope text NOT NULL,
 header_data bytea NOT NULL,
 header_hash bytea NOT NULL CHECK (octet_length(header_hash)=32),
 eof boolean NOT NULL DEFAULT false
);
CREATE TABLE execution_completion_frames (
 job_id uuid NOT NULL REFERENCES execution_completion_staging(job_id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('public','sample','private')),
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
 status text NOT NULL,
 frame_data bytea NOT NULL,
 frame_hash bytea NOT NULL CHECK (octet_length(frame_hash)=32),
 PRIMARY KEY(job_id,channel,ordinal)
);
CREATE TABLE execution_completion_receipts (
 job_id uuid NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 sandbox_scope text NOT NULL,
 outcome text NOT NULL CHECK (outcome IN ('completed','cancelled','failed','requeued')),
 PRIMARY KEY(job_id,attempt_id,sandbox_scope)
);
CREATE TABLE execution_completion_field_chunks (
 job_id uuid NOT NULL REFERENCES execution_completion_staging(job_id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('public','sample','private','header')),
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
 field text NOT NULL CHECK (field IN ('actual','expected','stdout','stderr','diagnostics','sqlTypes')),
 chunk_ordinal integer NOT NULL CHECK (chunk_ordinal >= 0),
 chunk_data bytea NOT NULL CHECK (octet_length(chunk_data) <= 65536),
 chunk_hash bytea NOT NULL CHECK (octet_length(chunk_hash) = 32),
 PRIMARY KEY(job_id,channel,ordinal,field,chunk_ordinal)
);
CREATE TABLE execution_completion_header_fields (
 job_id uuid NOT NULL REFERENCES execution_completion_staging(job_id) ON DELETE CASCADE,
 field text NOT NULL CHECK (field IN ('diagnostics','verdict','infrastructureError','hiddenCases')),
 field_data bytea NOT NULL,
 field_hash bytea NOT NULL CHECK (octet_length(field_hash) = 32),
 PRIMARY KEY(job_id,field)
);
CREATE TABLE submission_result_headers (
 submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
 header_data bytea NOT NULL
);
CREATE TABLE submission_public_result_cases (
 submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('public','sample')),
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
 result_data bytea NOT NULL,
 PRIMARY KEY(submission_id,channel,ordinal)
);
CREATE TABLE submission_result_header_fields (
 submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 field text NOT NULL CHECK (field IN ('diagnostics','verdict','infrastructureError','hiddenCases')),
 field_data bytea NOT NULL,
 PRIMARY KEY(submission_id,field)
);
-- Any terminal writer releases unfinished temporary result data.
CREATE FUNCTION cleanup_terminal_completion_staging() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.finished AND NOT OLD.finished THEN
  DELETE FROM execution_completion_staging WHERE job_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER execution_completion_terminal_cleanup AFTER UPDATE OF finished ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION cleanup_terminal_completion_staging();
-- Once published, readers can page without holding a database transaction open.
CREATE FUNCTION guard_terminal_result_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text; result_retained boolean; target uuid;
BEGIN
 target := CASE WHEN TG_OP='DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
 SELECT state,result IS NOT NULL INTO current_state,result_retained FROM submissions WHERE id=target FOR UPDATE;
 IF current_state IN ('completed','failed','cancelled') AND NOT
    ((TG_OP='INSERT' AND result_retained AND current_setting('quorem.result_backfill',true) IS NOT DISTINCT FROM 'v1') OR
     (TG_OP='DELETE' AND TG_TABLE_NAME='interview_private_result_cases' AND result_retained AND current_setting('quorem.legacy_private_rebuild',true) IS NOT DISTINCT FROM 'v1' AND NOT EXISTS(SELECT 1 FROM submission_result_headers WHERE submission_id=target)) OR
     (TG_OP='DELETE' AND NOT result_retained)) THEN
  RAISE EXCEPTION 'terminal result rows are immutable' USING ERRCODE='55000';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER submission_result_headers_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_result_headers FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
CREATE TRIGGER submission_public_result_cases_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_public_result_cases FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
CREATE TRIGGER submission_result_header_fields_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_result_header_fields FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
CREATE TRIGGER interview_private_result_cases_immutable BEFORE INSERT OR UPDATE OR DELETE ON interview_private_result_cases FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();

CREATE FUNCTION clear_normalized_submission_results() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.result IS NOT NULL AND NEW.result IS NULL THEN
  DELETE FROM submission_public_result_cases WHERE submission_id=NEW.id;
  DELETE FROM submission_result_headers WHERE submission_id=NEW.id;
  DELETE FROM submission_result_header_fields WHERE submission_id=NEW.id;
  DELETE FROM interview_private_result_cases WHERE submission_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER normalized_submission_result_retention AFTER UPDATE OF result ON submissions
 FOR EACH ROW EXECUTE FUNCTION clear_normalized_submission_results();
