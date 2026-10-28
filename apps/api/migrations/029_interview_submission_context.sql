ALTER TABLE submissions ADD COLUMN interview_id uuid REFERENCES interviews(id);
ALTER TABLE submissions ALTER COLUMN workspace_id DROP NOT NULL;

-- Interview execution already owns the authoritative question snapshot.
ALTER TABLE submissions DISABLE TRIGGER interview_result_realtime;
UPDATE submissions s SET interview_id=e.session_id,workspace_id=NULL
FROM interview_execution e WHERE e.submission_id=s.id;
ALTER TABLE submissions ENABLE TRIGGER interview_result_realtime;

ALTER TABLE submissions ADD CONSTRAINT submission_context_check
 CHECK ((workspace_id IS NULL) <> (interview_id IS NULL) AND (interview_id IS NULL OR match_id IS NULL));
ALTER TABLE submissions ADD CONSTRAINT submission_interview_identity UNIQUE (id,interview_id);
CREATE INDEX submissions_interview ON submissions(interview_id) WHERE interview_id IS NOT NULL;
ALTER TABLE interview_execution DROP CONSTRAINT interview_execution_submission_id_fkey;
ALTER TABLE interview_execution DROP CONSTRAINT interview_execution_session_id_fkey;
ALTER TABLE interview_execution ADD CONSTRAINT interview_execution_submission_session_fkey
 FOREIGN KEY (submission_id,session_id) REFERENCES submissions(id,interview_id) ON DELETE CASCADE;
