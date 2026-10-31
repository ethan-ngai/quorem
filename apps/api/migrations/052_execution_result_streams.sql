-- Staging belongs to one fenced attempt and is independent of resumable checkpoints.
CREATE TABLE execution_completion_staging (
 job_id uuid PRIMARY KEY REFERENCES execution_jobs(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 sandbox_scope text NOT NULL,
 header_data bytea NOT NULL,
 header_hash bytea NOT NULL CHECK (octet_length(header_hash)=32),
 eof boolean NOT NULL DEFAULT false,
 promoted boolean NOT NULL DEFAULT false
);
CREATE TABLE execution_completion_frames (
 job_id uuid NOT NULL REFERENCES execution_completion_staging(job_id) ON DELETE CASCADE,
 channel text NOT NULL CHECK (channel IN ('public','sample','private')),
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 319),
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
-- Once published, readers can page without holding a database transaction open.
CREATE FUNCTION guard_terminal_result_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text; target uuid;
BEGIN
 target := CASE WHEN TG_OP='DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
 SELECT state INTO current_state FROM submissions WHERE id=target FOR UPDATE;
 IF current_state IN ('completed','failed','cancelled') AND NOT
    (TG_OP='INSERT' AND current_setting('quorem.result_backfill',true)='v1') THEN
  RAISE EXCEPTION 'terminal result rows are immutable' USING ERRCODE='55000';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER submission_result_headers_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_result_headers FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
CREATE TRIGGER submission_public_result_cases_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_public_result_cases FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
