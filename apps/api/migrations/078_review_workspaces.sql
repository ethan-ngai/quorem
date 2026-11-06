ALTER TABLE workspaces ADD COLUMN review_match_id uuid REFERENCES matches(id), ADD COLUMN review_source_owner_id text REFERENCES users(id);
ALTER TABLE workspaces DROP CONSTRAINT workspaces_kind_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('solo','match','review'));
ALTER TABLE workspaces ADD CONSTRAINT workspace_review_kind CHECK (((kind='review' AND review_match_id IS NOT NULL AND review_source_owner_id IS NOT NULL) OR (kind<>'review' AND review_match_id IS NULL AND review_source_owner_id IS NULL)));
CREATE UNIQUE INDEX review_workspace_owner_source_language ON workspaces(review_match_id,owner_id,review_source_owner_id,language) WHERE kind='review';
CREATE OR REPLACE FUNCTION guard_workspace_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.owner_id,NEW.problem_version_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
    IS DISTINCT FROM (OLD.owner_id,OLD.problem_version_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    AND NOT (
      NEW.problem_version_id IS NULL AND OLD.problem_version_id IS NOT NULL
      AND current_setting('quorem.question_mutation',true) IS NOT DISTINCT FROM OLD.problem_version_id::text
      AND (NEW.owner_id,NEW.language,NEW.kind,NEW.match_id,NEW.review_match_id,NEW.review_source_owner_id)
        IS NOT DISTINCT FROM (OLD.owner_id,OLD.language,OLD.kind,OLD.match_id,OLD.review_match_id,OLD.review_source_owner_id)
    ) THEN
  RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER immutable_workspace_identity ON workspaces;
CREATE TRIGGER immutable_workspace_identity BEFORE UPDATE OF owner_id,problem_version_id,language,kind,match_id,review_match_id,review_source_owner_id ON workspaces FOR EACH ROW EXECUTE FUNCTION guard_workspace_identity();

CREATE OR REPLACE FUNCTION retain_practice_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS NULL OR NEW.match_id IS NOT NULL OR NEW.custom_run THEN
  RETURN NEW;
 END IF;
 IF EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND kind='solo') AND NEW.state='completed' AND NEW.kind='submit' AND
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


CREATE OR REPLACE FUNCTION queue_match_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_id IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO match_reconciliation_pending(match_id) VALUES (NEW.match_id)
    ON CONFLICT(match_id) DO UPDATE SET generation=match_reconciliation_pending.generation+1;
    PERFORM pg_notify('quorem_match_deadlines', '');
  END IF;
  RETURN NEW;
END $$;
