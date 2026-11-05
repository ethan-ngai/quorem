CREATE TABLE practice_case_feedback (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 case_index integer NOT NULL,
 admitted_at timestamptz NOT NULL,
 submission_id uuid NOT NULL,
 status_json bytea NOT NULL,
 PRIMARY KEY(workspace_id,case_index)
);

CREATE TABLE practice_solves (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Copy only the latest case status before detailed results are removed.
CREATE FUNCTION retain_practice_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS NULL OR NEW.match_id IS NOT NULL OR NEW.custom_run THEN
  RETURN NEW;
 END IF;
 IF NEW.state='completed' AND NEW.kind='submit' AND
    COALESCE(NEW.result,OLD.result)->>'verdict'='accepted' AND NEW.odyssey_level IS NULL THEN
  INSERT INTO practice_solves(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
 END IF;
 IF OLD.state='completed' AND OLD.result IS NOT NULL AND NEW.result IS NULL
    AND OLD.odyssey_level IS NOT NULL THEN
  INSERT INTO practice_case_feedback(workspace_id,case_index,admitted_at,submission_id,status_json)
  SELECT DISTINCT ON(c.case_index) OLD.workspace_id,c.case_index,OLD.admitted_at,OLD.id,c.status_json
  FROM submission_public_case_statuses c
  JOIN workspaces w ON w.id=OLD.workspace_id
  LEFT JOIN odyssey_progress p ON p.scope_id=w.id AND p.problem_version_id=w.problem_version_id
  WHERE c.submission_id=OLD.id
    AND c.channel=CASE WHEN OLD.kind='run' THEN 'public' ELSE 'sample' END
    AND OLD.admitted_at>=COALESCE(p.reset_at,'-infinity'::timestamptz)
  ORDER BY c.case_index,c.ordinal DESC
  ON CONFLICT(workspace_id,case_index) DO UPDATE
  SET admitted_at=EXCLUDED.admitted_at, submission_id=EXCLUDED.submission_id,
      status_json=EXCLUDED.status_json
  WHERE (practice_case_feedback.admitted_at,practice_case_feedback.submission_id)
        < (EXCLUDED.admitted_at,EXCLUDED.submission_id);
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER practice_feedback_retention BEFORE UPDATE OF result ON submissions
 FOR EACH ROW EXECUTE FUNCTION retain_practice_feedback();

INSERT INTO practice_solves(workspace_id)
SELECT DISTINCT workspace_id FROM submissions
WHERE workspace_id IS NOT NULL AND match_id IS NULL AND odyssey_level IS NULL
  AND NOT custom_run AND state='completed' AND kind='submit' AND result->>'verdict'='accepted';
