-- Keep legacy snapshots for older queue readers; public reads use normalized records.
CREATE TABLE problems (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
 current_version_id uuid
);
ALTER TABLE problem_versions ADD COLUMN problem_id uuid REFERENCES problems(id);
ALTER TABLE problem_versions ADD COLUMN title text;
ALTER TABLE problem_versions ADD COLUMN difficulty text CHECK(difficulty IN ('easy','medium','hard'));
ALTER TABLE problem_versions ADD COLUMN statement_markdown text;
ALTER TABLE problem_versions ADD COLUMN signature jsonb;
ALTER TABLE problem_versions ADD COLUMN constraints jsonb;
ALTER TABLE problem_versions ADD COLUMN limits jsonb;
ALTER TABLE problem_versions ADD COLUMN comparator text;
ALTER TABLE problem_versions ADD COLUMN attribution text;
ALTER TABLE problem_versions ADD CONSTRAINT problem_version_identity UNIQUE(problem_id,id);
ALTER TABLE problems ADD CONSTRAINT current_publication_identity FOREIGN KEY(id,current_version_id) REFERENCES problem_versions(problem_id,id) ON DELETE SET NULL (current_version_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX problem_versions_problem_id ON problem_versions(problem_id);
CREATE TABLE problem_languages (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 language text NOT NULL CHECK(language IN ('python','java','typescript','ocaml')),
 starter_source text NOT NULL, runtime_revision text NOT NULL, harness_revision text NOT NULL,
 reference_source text NOT NULL,
 PRIMARY KEY(version_id,language)
);
CREATE TABLE problem_examples (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal >= 0), args jsonb NOT NULL, expected jsonb NOT NULL,
 explanation text NOT NULL DEFAULT '', PRIMARY KEY(version_id,ordinal)
);
CREATE TABLE problem_test_cases (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal >= 0), args jsonb NOT NULL, expected jsonb NOT NULL,
 PRIMARY KEY(version_id,ordinal)
);
CREATE TABLE problem_tags (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 tag text NOT NULL CHECK(length(tag)>0), ordinal integer NOT NULL CHECK(ordinal >= 0),
 PRIMARY KEY(version_id,tag), UNIQUE(version_id,ordinal)
);
-- Editorial source is explicitly authored; never inferred from execution references.
CREATE TABLE problem_solutions (
 version_id uuid NOT NULL, language text NOT NULL,
 source text NOT NULL, explanation_markdown text NOT NULL,
 time_complexity text NOT NULL, space_complexity text NOT NULL, complexity_notes text NOT NULL,
 PRIMARY KEY(version_id,language),
 FOREIGN KEY(version_id,language) REFERENCES problem_languages(version_id,language) ON DELETE CASCADE
);
CREATE FUNCTION normalize_problem_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id uuid;
BEGIN
 INSERT INTO problems(slug) VALUES(NEW.slug) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id INTO identity_id;
 NEW.problem_id := identity_id;
 NEW.title := NEW.public->>'title'; NEW.difficulty := NEW.public->>'difficulty';
 NEW.statement_markdown := NEW.public->>'statementMarkdown'; NEW.signature := NEW.public->'signature';
 NEW.constraints := COALESCE(NEW.public->'constraints','[]'); NEW.limits := NEW.public->'limits';
 NEW.comparator := NEW.fixture->>'comparator'; NEW.attribution := NEW.fixture->>'attribution';
 RETURN NEW;
END $$;
CREATE FUNCTION normalize_problem_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO problem_languages VALUES(NEW.id,'python',NEW.public->>'starterSource',NEW.public->>'runtimeRevision',CASE WHEN NEW.fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE NEW.fixture->>'harnessRevision' END,NEW.fixture->>'referenceSource');
 INSERT INTO problem_examples SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->>'explanation','') FROM jsonb_array_elements(NEW.public->'examples') WITH ORDINALITY;
 INSERT INTO problem_test_cases SELECT NEW.id, ordinality-1, value->'args',value->'expected' FROM jsonb_array_elements(NEW.fixture->'hiddenCases') WITH ORDINALITY;
 INSERT INTO problem_tags SELECT NEW.id,value,ordinality-1 FROM jsonb_array_elements_text(NEW.public->'tags') WITH ORDINALITY;
 UPDATE problems SET current_version_id=NEW.id WHERE id=NEW.problem_id AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<NEW.version);
 RETURN NEW;
END $$;
-- Upgrade existing immutable IDs without touching their workspace/submission references.
INSERT INTO problems(slug) SELECT DISTINCT slug FROM problem_versions;
UPDATE problem_versions v SET problem_id=p.id,title=public->>'title',difficulty=public->>'difficulty',statement_markdown=public->>'statementMarkdown',signature=public->'signature',constraints=COALESCE(public->'constraints','[]'),limits=public->'limits',comparator=fixture->>'comparator',attribution=fixture->>'attribution' FROM problems p WHERE p.slug=v.slug;
INSERT INTO problem_languages SELECT id,'python',public->>'starterSource',public->>'runtimeRevision',CASE WHEN fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE fixture->>'harnessRevision' END,fixture->>'referenceSource' FROM problem_versions;
INSERT INTO problem_examples SELECT v.id,e.ordinality-1,e.value->'args',e.value->'expected',COALESCE(e.value->>'explanation','') FROM problem_versions v CROSS JOIN LATERAL jsonb_array_elements(v.public->'examples') WITH ORDINALITY e;
INSERT INTO problem_test_cases SELECT v.id,e.ordinality-1,e.value->'args',e.value->'expected' FROM problem_versions v CROSS JOIN LATERAL jsonb_array_elements(v.fixture->'hiddenCases') WITH ORDINALITY e;
INSERT INTO problem_tags SELECT v.id,e.value,e.ordinality-1 FROM problem_versions v CROSS JOIN LATERAL jsonb_array_elements_text(v.public->'tags') WITH ORDINALITY e;
UPDATE problems p SET current_version_id=(SELECT id FROM problem_versions v WHERE v.problem_id=p.id ORDER BY version DESC LIMIT 1);
ALTER TABLE problem_versions ALTER COLUMN problem_id SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN title SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN difficulty SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN statement_markdown SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN signature SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN constraints SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN limits SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN comparator SET NOT NULL;
ALTER TABLE problem_versions ALTER COLUMN attribution SET NOT NULL;
CREATE TRIGGER normalize_problem_before BEFORE INSERT ON problem_versions FOR EACH ROW EXECUTE FUNCTION normalize_problem_insert();
CREATE TRIGGER normalize_problem_after AFTER INSERT ON problem_versions FOR EACH ROW EXECUTE FUNCTION normalize_problem_children();

CREATE FUNCTION immutable_problem_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Published problem content is immutable; create a new version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_problem_version BEFORE UPDATE ON problem_versions FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER immutable_problem_language BEFORE UPDATE ON problem_languages FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER immutable_problem_example BEFORE UPDATE ON problem_examples FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER immutable_problem_case BEFORE UPDATE ON problem_test_cases FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER immutable_problem_tag BEFORE UPDATE ON problem_tags FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER immutable_problem_solution BEFORE UPDATE ON problem_solutions FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
