ALTER TABLE question_publications ADD COLUMN case_budget jsonb;

CREATE OR REPLACE FUNCTION public.immutable_problem_content()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='question_publications' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash','acceptance','case_budget']::text[]
  THEN RAISE EXCEPTION 'Question seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash,NEW.acceptance,NEW.case_budget)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash,OLD.acceptance,OLD.case_budget)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $function$;
