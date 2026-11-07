-- Compare native columns; JSON conversion expands bytea sidecars and exceeds JSONB limits.
CREATE OR REPLACE FUNCTION immutable_problem_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','version','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages']::text[]
  THEN RAISE EXCEPTION 'Problem version seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.version,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.version,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Published problem content is immutable; create a new version' USING ERRCODE='23514';
END $$;
