ALTER TABLE problem_examples ADD COLUMN calls jsonb NOT NULL DEFAULT '[]';
ALTER TABLE problem_test_cases ADD COLUMN calls jsonb NOT NULL DEFAULT '[]';

-- Restore method calls omitted by the original projection, including sealed versions.
ALTER TABLE problem_examples DISABLE TRIGGER immutable_problem_example;
ALTER TABLE problem_examples DISABLE TRIGGER sealed_problem_example;
UPDATE problem_examples e SET calls=COALESCE(v.public->'examples'->e.ordinal->'calls','[]')
FROM problem_versions v WHERE v.id=e.version_id;
ALTER TABLE problem_examples ENABLE TRIGGER immutable_problem_example;
ALTER TABLE problem_examples ENABLE TRIGGER sealed_problem_example;

ALTER TABLE problem_test_cases DISABLE TRIGGER immutable_problem_case;
ALTER TABLE problem_test_cases DISABLE TRIGGER sealed_problem_case;
UPDATE problem_test_cases c SET calls=COALESCE(v.fixture->'hiddenCases'->c.ordinal->'calls','[]')
FROM problem_versions v WHERE v.id=c.version_id;
ALTER TABLE problem_test_cases ENABLE TRIGGER immutable_problem_case;
ALTER TABLE problem_test_cases ENABLE TRIGGER sealed_problem_case;

CREATE OR REPLACE FUNCTION normalize_problem_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO problem_languages VALUES(NEW.id,CASE WHEN NEW.public->'sql' IS NOT NULL THEN 'postgresql' ELSE 'python' END,NEW.public->>'starterSource',NEW.public->>'runtimeRevision',CASE WHEN NEW.fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE NEW.fixture->>'harnessRevision' END,NEW.fixture->>'referenceSource');
 INSERT INTO problem_examples(version_id,ordinal,args,expected,explanation,calls) SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->>'explanation',''),COALESCE(value->'calls','[]') FROM jsonb_array_elements(NEW.public->'examples') WITH ORDINALITY;
 INSERT INTO problem_test_cases(version_id,ordinal,args,expected,calls) SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->'calls','[]') FROM jsonb_array_elements(NEW.fixture->'hiddenCases') WITH ORDINALITY;
 INSERT INTO problem_tags SELECT NEW.id,value,ordinality-1 FROM jsonb_array_elements_text(NEW.public->'tags') WITH ORDINALITY;
 UPDATE problems SET current_version_id=NEW.id WHERE id=NEW.problem_id AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<NEW.version);
 RETURN NEW;
END $$;
