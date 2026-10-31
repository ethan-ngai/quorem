-- A verification challenge freezes one admitted attempt and its raw output chunks.
CREATE TABLE execution_verification_challenges (
 id uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES execution_completion_staging(job_id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 sandbox_scope text NOT NULL,
 job_data text NOT NULL,
 result_channel text NOT NULL CHECK (result_channel IN ('public','sample','private')),
 result_ordinal integer NOT NULL CHECK (result_ordinal BETWEEN 0 AND 2147483646),
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 2147483646),
 channel text NOT NULL CHECK (channel IN ('public','sample','private')),
 frame_hash bytea NOT NULL CHECK (octet_length(frame_hash)=32),
 raw_status text NOT NULL,
 UNIQUE (job_id,ordinal),
 FOREIGN KEY (job_id,ordinal) REFERENCES runner_job_input_cases(job_id,ordinal)
);
CREATE TABLE execution_verification_output_chunks (
 challenge_id uuid NOT NULL REFERENCES execution_verification_challenges(id) ON DELETE CASCADE,
 field text NOT NULL CHECK (field IN ('actual','expected')),
 ordinal integer NOT NULL CHECK (ordinal>=0),
 data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 65536),
 hash bytea NOT NULL CONSTRAINT execution_verification_output_chunks_hash_check CHECK (hash=sha256(data)),
 PRIMARY KEY(challenge_id,field,ordinal)
);
-- Only the verifier receipt consumer may create these rows, after comparing the
-- signed binding to the live locked job, sealed manifest, challenge and fields.
CREATE TABLE execution_verified_cases (
 job_id uuid NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
 ordinal integer NOT NULL,
 attempt_id uuid NOT NULL,
 sandbox_scope text NOT NULL,
 challenge_id uuid NOT NULL,
 binding bytea NOT NULL CHECK (octet_length(binding)=32),
 frame_hash bytea NOT NULL CHECK (octet_length(frame_hash)=32),
 actual_hash bytea CHECK (actual_hash IS NULL OR octet_length(actual_hash)=32),
 expected_hash bytea CHECK (expected_hash IS NULL OR octet_length(expected_hash)=32),
 status text NOT NULL CHECK (status IN ('accepted','wrong_answer','executed','syntax_error','runtime_error','time_limit','memory_limit','output_limit','invalid_output')),
 PRIMARY KEY(job_id,attempt_id,ordinal),
 FOREIGN KEY(job_id,ordinal) REFERENCES runner_job_input_cases(job_id,ordinal)
);
CREATE FUNCTION execution_verified_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'verified cases are immutable'; END IF;
 IF EXISTS(SELECT 1 FROM execution_jobs WHERE id=OLD.job_id) THEN RAISE EXCEPTION 'verified cases are immutable'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER execution_verified_case_immutable BEFORE UPDATE OR DELETE ON execution_verified_cases FOR EACH ROW EXECUTE FUNCTION execution_verified_case_guard();
