ALTER TABLE interview_execution ADD CONSTRAINT interview_execution_identity UNIQUE (submission_id,session_id);
ALTER TABLE submissions ADD CONSTRAINT submission_interview_execution_fkey
 FOREIGN KEY (id,interview_id) REFERENCES interview_execution(submission_id,session_id)
 DEFERRABLE INITIALLY DEFERRED;
