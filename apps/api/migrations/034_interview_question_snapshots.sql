CREATE TABLE interview_question_snapshots (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 id bytea NOT NULL,
 fixture jsonb NOT NULL,
 PRIMARY KEY (session_id,id),
 CHECK (id=sha256(convert_to(fixture::text,'UTF8')))
);
INSERT INTO interview_question_snapshots(session_id,id,fixture)
SELECT DISTINCT session_id,sha256(convert_to(fixture::text,'UTF8')),fixture FROM interview_execution;

ALTER TABLE interview_execution ADD COLUMN fixture_id bytea;
ALTER TABLE interview_execution DISABLE TRIGGER interview_execution_realtime;
UPDATE interview_execution SET fixture_id=sha256(convert_to(fixture::text,'UTF8'));
ALTER TABLE interview_execution ENABLE TRIGGER interview_execution_realtime;
ALTER TABLE interview_execution ALTER COLUMN fixture_id SET NOT NULL;
ALTER TABLE interview_execution ADD CONSTRAINT interview_execution_fixture_fkey
 FOREIGN KEY (session_id,fixture_id) REFERENCES interview_question_snapshots(session_id,id);
ALTER TABLE interview_execution DROP COLUMN fixture;

CREATE FUNCTION immutable_interview_question_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Interview question snapshots are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_interview_question_snapshot BEFORE UPDATE ON interview_question_snapshots
FOR EACH ROW EXECUTE FUNCTION immutable_interview_question_snapshot();

CREATE FUNCTION immutable_interview_execution_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'private_results') IS DISTINCT FROM (to_jsonb(OLD)-'private_results') THEN
  RAISE EXCEPTION 'Interview execution context is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_interview_execution_context BEFORE UPDATE ON interview_execution
FOR EACH ROW EXECUTE FUNCTION immutable_interview_execution_context();
