CREATE TABLE interview_private_status_headers (
 submission_id uuid PRIMARY KEY REFERENCES interview_execution(submission_id) ON DELETE CASCADE,
 status_count integer NOT NULL CHECK (status_count >= 0),
 CONSTRAINT interview_private_status_headers_result_fkey FOREIGN KEY (submission_id) REFERENCES submission_result_headers(submission_id) ON DELETE CASCADE
);
CREATE TABLE interview_private_case_statuses (
 submission_id uuid NOT NULL REFERENCES interview_private_status_headers(submission_id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 case_id text NOT NULL,
 status_json bytea NOT NULL CHECK (json_typeof(convert_from(status_json,'UTF8')::json)='string'),
 status_hash bytea NOT NULL CONSTRAINT interview_private_case_statuses_status_hash_check CHECK (status_hash=sha256(status_json)),
 PRIMARY KEY(submission_id,ordinal),
 UNIQUE(submission_id,case_id)
);
CREATE TRIGGER interview_private_status_headers_immutable BEFORE INSERT OR UPDATE OR DELETE ON interview_private_status_headers FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
CREATE TRIGGER interview_private_case_statuses_immutable BEFORE INSERT OR UPDATE OR DELETE ON interview_private_case_statuses FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
