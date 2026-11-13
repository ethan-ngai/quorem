UPDATE matches
SET rules=jsonb_set(rules,'{acceptance}','"efficient"')
WHERE rules->>'acceptance'='optimal';

UPDATE parties
SET settings=jsonb_set(settings,'{rules,acceptance}','"efficient"')
WHERE settings #>> '{rules,acceptance}'='optimal';

ALTER TABLE question_publications DISABLE TRIGGER immutable_publication;
UPDATE question_publications SET acceptance=acceptance-'optimal' WHERE acceptance ? 'optimal';
ALTER TABLE question_publications ENABLE TRIGGER immutable_publication;

SELECT set_config('quorem.lossless_case_write','v1',true);
UPDATE question_drafts
SET content=content #- '{problem,acceptance,optimal}',
    lossless_content=CASE WHEN lossless_content IS NOT NULL THEN convert_to((
      SELECT json_object_agg(root.key,CASE WHEN root.key='problem' THEN (
        SELECT json_object_agg(problem.key,CASE WHEN problem.key='acceptance' THEN (
          SELECT json_object_agg(profile.key,profile.value)
          FROM json_each(problem.value) profile WHERE profile.key<>'optimal'
        ) ELSE problem.value END)
        FROM json_each(root.value) problem
      ) ELSE root.value END)
      FROM json_each(convert_from(lossless_content,'UTF8')::json) root
    )::text,'UTF8') END,
    import_digest=NULL,
    revision=revision+1,
    updated_at=clock_timestamp()
WHERE content->'problem'->'acceptance' ? 'optimal';

UPDATE submissions SET practice_target='efficient' WHERE practice_target='optimal';
ALTER TABLE submissions DROP CONSTRAINT submissions_practice_target_check,
  ADD CONSTRAINT submissions_practice_target_check CHECK (practice_target IN ('small','efficient'));

UPDATE practice_target_progress SET tier=2 WHERE tier=3;
ALTER TABLE practice_target_progress DROP CONSTRAINT practice_target_progress_tier_check,
  ADD CONSTRAINT practice_target_progress_tier_check CHECK (tier BETWEEN 1 AND 2);
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
   VALUES(NEW.workspace_id,CASE NEW.practice_target WHEN 'small' THEN 1 ELSE 2 END)
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
