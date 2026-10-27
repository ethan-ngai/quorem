CREATE OR REPLACE FUNCTION normalize_problem_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id uuid;
BEGIN
 INSERT INTO problems(slug) VALUES(NEW.slug) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id INTO identity_id;
 NEW.problem_id := identity_id;
 NEW.title := NEW.public->>'title'; NEW.difficulty := NEW.public->>'difficulty';
 NEW.statement_markdown := NEW.public->>'statementMarkdown'; NEW.signature := NEW.public->'signature';
 NEW.constraints := COALESCE(NEW.public->'constraints','[]'); NEW.limits := NEW.public->'limits';
 NEW.attribution := NEW.fixture->>'attribution';
 RETURN NEW;
END $$;
ALTER TABLE problem_versions DROP COLUMN comparator;
