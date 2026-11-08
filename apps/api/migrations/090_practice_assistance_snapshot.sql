ALTER TABLE submissions ADD COLUMN practice_assisted boolean NOT NULL DEFAULT false;

-- Existing in-flight admissions retain the best available pre-cutover evidence.
UPDATE submissions s SET practice_assisted=true
FROM workspaces w JOIN question_exposure x ON x.version_id=w.problem_version_id
WHERE s.workspace_id=w.id AND s.owner_id=x.owner_id
  AND s.state IN ('queued','running')
  AND x.assisted_at BETWEEN s.admitted_at-interval '1 day' AND s.admitted_at;

CREATE FUNCTION snapshot_practice_assistance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS NOT NULL THEN
  NEW.practice_assisted := EXISTS (
   SELECT 1 FROM workspaces w JOIN question_exposure x ON x.version_id=w.problem_version_id
   WHERE w.id=NEW.workspace_id AND x.owner_id=NEW.owner_id
     AND x.assisted_at BETWEEN NEW.admitted_at-interval '1 day' AND NEW.admitted_at
  );
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_practice_assistance BEFORE INSERT ON submissions
 FOR EACH ROW EXECUTE FUNCTION snapshot_practice_assistance();

CREATE OR REPLACE FUNCTION mark_learning_assistance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.assisted := EXISTS (
  SELECT 1 FROM submissions s WHERE s.id=NEW.submission_id AND s.practice_assisted
 ) OR (NEW.context='match' AND EXISTS (
  SELECT 1 FROM submissions s JOIN match_participants p ON p.match_id=s.match_id AND p.owner_id=NEW.owner_id
  JOIN match_rule_events r ON r.match_id=p.match_id AND r.competitor_id=COALESCE(p.competitor_id,p.owner_id)
  WHERE s.id=NEW.submission_id AND r.kind IN ('hiddenCase','topics','complexity')
    AND r.resource_key IS NOT NULL AND r.occurred_at<=NEW.attempted_at
 ));
 RETURN NEW;
END $$;
