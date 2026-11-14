CREATE OR REPLACE FUNCTION public.observe_question_result()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
 question record;
 verdict text := NEW.result->>'verdict';
BEGIN
 IF NEW.state<>'completed' OR OLD.state='completed' OR NEW.kind<>'submit'
  OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.owner_id AND kind='account')
  OR NEW.custom_run OR NEW.interview_id IS NOT NULL OR verdict IS NULL
  OR verdict NOT IN ('accepted','wrong_answer','time_limit','runtime_error','memory_limit') THEN
  RETURN NEW;
 END IF;
 SELECT v.id,v.difficulty INTO question FROM workspaces w JOIN question_publications v ON v.id=w.publication_id
 WHERE w.id=NEW.workspace_id AND w.kind IN ('solo','match')
 AND (NEW.odyssey_level IS NULL OR NEW.odyssey_level=jsonb_array_length(v.odyssey->'levels'));
 IF question.id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO question_learning_events(submission_id,owner_id,publication_id,difficulty,tags,accepted,context,attempted_at)
 VALUES(NEW.id,NEW.owner_id,question.id,question.difficulty,
  ARRAY(SELECT tag FROM problem_tags WHERE publication_id=question.id ORDER BY ordinal),verdict='accepted',
  CASE WHEN NEW.match_id IS NOT NULL THEN 'match' ELSE 'practice' END,NEW.admitted_at)
 ON CONFLICT DO NOTHING;
 INSERT INTO question_exposure(owner_id,publication_id,last_seen_at) VALUES(NEW.owner_id,question.id,clock_timestamp())
 ON CONFLICT(owner_id,publication_id) DO UPDATE SET last_seen_at=GREATEST(question_exposure.last_seen_at,EXCLUDED.last_seen_at);
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.observe_question_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.kind IN ('solo','match') AND NEW.publication_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM users WHERE id=NEW.owner_id AND kind='account') THEN
  INSERT INTO question_exposure(owner_id,publication_id,last_seen_at)
  VALUES(NEW.owner_id,NEW.publication_id,clock_timestamp())
  ON CONFLICT(owner_id,publication_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at;
 END IF;
 RETURN NEW;
END $function$;

DELETE FROM question_exposure e USING users u WHERE e.owner_id=u.id AND u.kind='guest';
DELETE FROM question_learning_events e USING users u WHERE e.owner_id=u.id AND u.kind='guest';
