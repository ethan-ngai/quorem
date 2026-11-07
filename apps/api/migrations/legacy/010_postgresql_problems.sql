ALTER TABLE problem_languages DROP CONSTRAINT problem_languages_language_check;
ALTER TABLE problem_languages ADD CONSTRAINT problem_languages_language_check CHECK (language IN ('python','java','typescript','ocaml','postgresql'));
ALTER TABLE workspaces DROP CONSTRAINT workspaces_language_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_language_check CHECK (language IN ('python','java','typescript','ocaml','postgresql'));

CREATE OR REPLACE FUNCTION normalize_problem_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO problem_languages VALUES(NEW.id,CASE WHEN NEW.public->'sql' IS NOT NULL THEN 'postgresql' ELSE 'python' END,NEW.public->>'starterSource',NEW.public->>'runtimeRevision',CASE WHEN NEW.fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE NEW.fixture->>'harnessRevision' END,NEW.fixture->>'referenceSource');
 INSERT INTO problem_examples SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->>'explanation','') FROM jsonb_array_elements(NEW.public->'examples') WITH ORDINALITY;
 INSERT INTO problem_test_cases SELECT NEW.id, ordinality-1, value->'args',value->'expected' FROM jsonb_array_elements(NEW.fixture->'hiddenCases') WITH ORDINALITY;
 INSERT INTO problem_tags SELECT NEW.id,value,ordinality-1 FROM jsonb_array_elements_text(NEW.public->'tags') WITH ORDINALITY;
 UPDATE problems SET current_version_id=NEW.id WHERE id=NEW.problem_id AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<NEW.version);
 RETURN NEW;
END $$;
