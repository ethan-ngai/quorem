ALTER TABLE problem_versions ADD COLUMN sql_config jsonb;
ALTER TABLE problem_versions ADD COLUMN odyssey jsonb;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM problem_versions WHERE public->'sql' IS DISTINCT FROM fixture->'problem'->'sql'
     OR public->'odyssey' IS DISTINCT FROM fixture->'problem'->'odyssey') THEN
  RAISE EXCEPTION 'Problem type configuration differs between published snapshots';
 END IF;
END $$;

-- Published versions are immutable; migrate their existing configuration in place.
ALTER TABLE problem_versions DISABLE TRIGGER immutable_problem_version;
UPDATE problem_versions SET sql_config=public->'sql', odyssey=public->'odyssey';
ALTER TABLE problem_versions ENABLE TRIGGER immutable_problem_version;

CREATE OR REPLACE FUNCTION normalize_problem_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id uuid;
BEGIN
 INSERT INTO problems(slug) VALUES(NEW.slug) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id INTO identity_id;
 NEW.problem_id := identity_id;
 NEW.title := NEW.public->>'title'; NEW.difficulty := NEW.public->>'difficulty';
 NEW.statement_markdown := NEW.public->>'statementMarkdown'; NEW.signature := NEW.public->'signature';
 NEW.constraints := COALESCE(NEW.public->'constraints','[]'); NEW.limits := NEW.public->'limits';
 NEW.attribution := NEW.fixture->>'attribution';
 NEW.sql_config := NEW.public->'sql'; NEW.odyssey := NEW.public->'odyssey';
 RETURN NEW;
END $$;
