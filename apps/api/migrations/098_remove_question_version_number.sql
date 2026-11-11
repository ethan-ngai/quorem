-- Keep hashes used by existing runner indexes after removing the numeric field.
CREATE TEMP TABLE publication_hashes_before ON COMMIT DROP AS
SELECT p.id,p.xmin::text AS token,r.fixture_hash
FROM problem_versions p JOIN runner_version_inputs r ON r.version_id=p.id
WHERE p.fixture_identity_hash IS NULL AND p.lossless_fixture IS NULL;

ALTER TABLE problem_versions DISABLE TRIGGER immutable_problem_version;
UPDATE problem_versions p SET fixture_identity_hash=b.fixture_hash
FROM publication_hashes_before b WHERE p.id=b.id;
ALTER TABLE problem_versions ENABLE TRIGGER immutable_problem_version;

UPDATE question_drafts d SET edit_base=p.xmin::text
FROM publication_hashes_before b JOIN problem_versions p ON p.id=b.id
WHERE d.edit_version_id=p.id AND d.edit_base=b.token;

ALTER TABLE problem_versions DROP COLUMN version;

CREATE OR REPLACE FUNCTION public.immutable_problem_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash']::text[]
  THEN RAISE EXCEPTION 'Question seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $$;
