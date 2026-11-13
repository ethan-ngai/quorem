ALTER TABLE question_publications ADD COLUMN acceptance jsonb;
ALTER TABLE submissions ADD COLUMN practice_target text CHECK (practice_target IN ('small','efficient','optimal'));

CREATE TABLE practice_target_progress (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  tier integer NOT NULL CHECK (tier BETWEEN 1 AND 3)
);

CREATE OR REPLACE FUNCTION public.immutable_problem_content()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='question_publications' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash','acceptance']::text[]
  THEN RAISE EXCEPTION 'Question seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash,NEW.acceptance)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash,OLD.acceptance)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $function$;

CREATE OR REPLACE FUNCTION public.retain_practice_feedback()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.workspace_id IS NULL OR NEW.match_id IS NOT NULL OR NEW.custom_run THEN
  RETURN NEW;
 END IF;
 IF EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND kind='solo') AND NEW.state='completed' AND NEW.kind='submit' AND
    COALESCE(NEW.result,OLD.result)->>'verdict'='accepted' AND NEW.odyssey_level IS NULL THEN
  IF NEW.practice_target IS DISTINCT FROM 'small' THEN
   INSERT INTO practice_solves(workspace_id) VALUES(NEW.workspace_id) ON CONFLICT DO NOTHING;
  END IF;
  IF OLD.state <> 'completed' THEN
   INSERT INTO practice_target_progress(workspace_id,tier)
   VALUES(NEW.workspace_id,CASE NEW.practice_target WHEN 'small' THEN 1 WHEN 'optimal' THEN 3 ELSE 2 END)
   ON CONFLICT(workspace_id) DO UPDATE SET tier=GREATEST(practice_target_progress.tier,EXCLUDED.tier);
  END IF;
 END IF;
 IF OLD.state='completed' AND OLD.result IS NOT NULL AND NEW.result IS NULL
    AND OLD.odyssey_level IS NOT NULL THEN
  INSERT INTO practice_case_feedback(workspace_id,case_index,admitted_at,submission_id,status_json)
  SELECT DISTINCT ON(c.case_index) OLD.workspace_id,c.case_index,OLD.admitted_at,OLD.id,c.status_json
  FROM submission_public_case_statuses c
  JOIN workspaces w ON w.id=OLD.workspace_id
  LEFT JOIN odyssey_progress p ON p.scope_id=w.id AND p.publication_id=w.publication_id
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
END $function$;
