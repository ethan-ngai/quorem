-- Lossless payloads accompany JSONB compatibility projections only when needed.
ALTER TABLE question_drafts ADD COLUMN lossless_content bytea;
ALTER TABLE problem_versions ADD COLUMN lossless_fixture bytea;
ALTER TABLE problem_versions ADD COLUMN lossless_public bytea;
ALTER TABLE problem_versions ADD COLUMN lossless_stages bytea;
ALTER TABLE interviews ADD COLUMN lossless_question bytea;
ALTER TABLE interview_question_snapshots ADD COLUMN lossless_fixture bytea;
ALTER TABLE submissions ADD COLUMN lossless_cases bytea;
ALTER TABLE interview_question_snapshots ADD CONSTRAINT lossless_fixture_hash CHECK (lossless_fixture IS NULL OR (fixture->>'_lossless_sha256') IS NOT DISTINCT FROM encode(sha256(lossless_fixture),'hex'));

-- Old judges must not consume sanitized projections as test cases.
CREATE FUNCTION guard_lossless_case_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
    AND current_setting('quorem.lossless_case_claim', true) IS DISTINCT FROM 'v1'
    AND EXISTS (
      SELECT 1 FROM submissions s
      LEFT JOIN workspaces w ON w.id=s.workspace_id
      LEFT JOIN problem_versions v ON v.id=w.problem_version_id
      LEFT JOIN interview_execution ie ON ie.submission_id=s.id
      LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id
      WHERE s.id=NEW.submission_id AND (s.lossless_cases IS NOT NULL OR v.lossless_fixture IS NOT NULL OR q.lossless_fixture IS NOT NULL)
    ) THEN
   RAISE EXCEPTION 'lossless case-capable judge required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_lossless_case_claim_guard BEFORE UPDATE OF attempt_id ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION guard_lossless_case_claim();

CREATE FUNCTION guard_lossless_draft_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lossless_content IS NOT NULL AND current_setting('quorem.lossless_case_write',true) IS DISTINCT FROM 'v1' THEN
   RAISE EXCEPTION 'lossless case-capable authoring required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER question_draft_lossless_guard BEFORE UPDATE OF content ON question_drafts
 FOR EACH ROW EXECUTE FUNCTION guard_lossless_draft_update();

CREATE FUNCTION guard_lossless_interview_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lossless_question IS NOT NULL AND current_setting('quorem.lossless_case_write',true) IS DISTINCT FROM 'v1' THEN
   RAISE EXCEPTION 'lossless case-capable interview writer required';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER interview_lossless_guard BEFORE UPDATE OF question ON interviews
 FOR EACH ROW EXECUTE FUNCTION guard_lossless_interview_update();

CREATE FUNCTION guard_lossless_case_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lossless_cases IS NOT NULL AND NEW.cases IS DISTINCT FROM OLD.cases
    AND NEW.lossless_cases IS NOT DISTINCT FROM OLD.lossless_cases THEN
   IF NEW.cases = '[]'::jsonb AND NEW.state NOT IN ('queued','running') THEN
     NEW.lossless_cases := NULL;
   ELSE
     RAISE EXCEPTION 'lossless case-capable writer required';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submission_lossless_case_guard BEFORE UPDATE OF cases ON submissions
 FOR EACH ROW EXECUTE FUNCTION guard_lossless_case_cleanup();
