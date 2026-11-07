-- Preserve normalized status bytes independently of potentially large result bodies.
CREATE TABLE submission_public_case_statuses (
 submission_id uuid NOT NULL,
 channel text NOT NULL,
 ordinal integer NOT NULL,
 case_index integer NOT NULL CHECK (case_index >= 0),
 status_json bytea NOT NULL CHECK (json_typeof(convert_from(status_json,'UTF8')::json)='string'),
 status_hash bytea NOT NULL CONSTRAINT submission_public_case_statuses_status_hash_check CHECK (status_hash=sha256(status_json)),
 PRIMARY KEY(submission_id,channel,ordinal),
 CONSTRAINT submission_public_case_statuses_submission_id_channel_ord_fkey FOREIGN KEY(submission_id,channel,ordinal) REFERENCES submission_public_result_cases(submission_id,channel,ordinal) ON DELETE CASCADE
);
CREATE TRIGGER submission_public_case_statuses_immutable BEFORE INSERT OR UPDATE OR DELETE ON submission_public_case_statuses FOR EACH ROW EXECUTE FUNCTION guard_terminal_result_rows();
