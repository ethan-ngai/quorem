DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM problem_versions WHERE public IS DISTINCT FROM fixture->'problem') THEN
  RAISE EXCEPTION 'Published problem snapshots differ; reconcile before normalizing';
 END IF;
 IF EXISTS (
  SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id
  WHERE v.id::text IS DISTINCT FROM v.public->>'id' OR v.version::text IS DISTINCT FROM v.public->>'version'
   OR p.slug IS DISTINCT FROM v.public->>'slug' OR v.title IS DISTINCT FROM v.public->>'title'
   OR v.difficulty IS DISTINCT FROM v.public->>'difficulty' OR v.signature IS DISTINCT FROM v.public->'signature'
   OR v.statement_markdown IS DISTINCT FROM v.public->>'statementMarkdown' OR v.limits IS DISTINCT FROM v.public->'limits'
   OR v.constraints IS DISTINCT FROM COALESCE(v.public->'constraints','[]'::jsonb)
   OR v.attribution IS DISTINCT FROM v.fixture->>'attribution'
   OR COALESCE((SELECT jsonb_agg(t.tag ORDER BY t.ordinal) FROM problem_tags t WHERE t.version_id=v.id),'[]'::jsonb) IS DISTINCT FROM v.public->'tags'
   OR (SELECT count(*) FROM problem_examples e WHERE e.version_id=v.id) <> jsonb_array_length(v.public->'examples')
   OR EXISTS (SELECT 1 FROM problem_examples e WHERE e.version_id=v.id AND
    (e.args IS DISTINCT FROM v.public->'examples'->e.ordinal->'args' OR e.expected IS DISTINCT FROM v.public->'examples'->e.ordinal->'expected'
     OR e.calls IS DISTINCT FROM COALESCE(v.public->'examples'->e.ordinal->'calls','[]'::jsonb)))
   OR (SELECT count(*) FROM problem_test_cases c WHERE c.version_id=v.id) <> jsonb_array_length(v.fixture->'hiddenCases')
   OR EXISTS (SELECT 1 FROM problem_test_cases c WHERE c.version_id=v.id AND
    (c.args IS DISTINCT FROM v.fixture->'hiddenCases'->c.ordinal->'args' OR c.expected IS DISTINCT FROM v.fixture->'hiddenCases'->c.ordinal->'expected'
     OR c.calls IS DISTINCT FROM COALESCE(v.fixture->'hiddenCases'->c.ordinal->'calls','[]'::jsonb)))
 ) THEN
  RAISE EXCEPTION 'Published problem projections differ; reconcile before normalizing';
 END IF;
END $$;

CREATE TABLE problem_odyssey_cases (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 level integer NOT NULL CHECK (level >= 0),
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 case_data jsonb NOT NULL,
 PRIMARY KEY (version_id,level,ordinal)
);

INSERT INTO problem_odyssey_cases(version_id,level,ordinal,case_data)
SELECT v.id,stage.ordinality-1,c.ordinality-1,c.value
FROM problem_versions v,
 LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.fixture->'odysseyHiddenCases')='array' THEN v.fixture->'odysseyHiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY stage(value,ordinality),
 LATERAL jsonb_array_elements(stage.value) WITH ORDINALITY c(value,ordinality);

CREATE TRIGGER immutable_problem_odyssey_case BEFORE UPDATE ON problem_odyssey_cases
FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER sealed_problem_odyssey_case BEFORE INSERT OR DELETE OR UPDATE ON problem_odyssey_cases
FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE OR REPLACE FUNCTION normalize_problem_children() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO problem_languages VALUES(NEW.id,CASE WHEN NEW.public->'sql' IS NOT NULL THEN 'postgresql' ELSE 'python' END,NEW.public->>'starterSource',NEW.public->>'runtimeRevision',CASE WHEN NEW.fixture->>'harnessRevision'='quorem-harness-v1' THEN 'quorem-harness-v2' ELSE NEW.fixture->>'harnessRevision' END,NEW.fixture->>'referenceSource');
 INSERT INTO problem_examples(version_id,ordinal,args,expected,explanation,calls) SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->>'explanation',''),COALESCE(value->'calls','[]') FROM jsonb_array_elements(NEW.public->'examples') WITH ORDINALITY;
 INSERT INTO problem_test_cases(version_id,ordinal,args,expected,calls) SELECT NEW.id, ordinality-1, value->'args',value->'expected',COALESCE(value->'calls','[]') FROM jsonb_array_elements(NEW.fixture->'hiddenCases') WITH ORDINALITY;
 INSERT INTO problem_odyssey_cases(version_id,level,ordinal,case_data)
 SELECT NEW.id,stage.ordinality-1,c.ordinality-1,c.value
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.fixture->'odysseyHiddenCases')='array' THEN NEW.fixture->'odysseyHiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY stage(value,ordinality),
 LATERAL jsonb_array_elements(stage.value) WITH ORDINALITY c(value,ordinality);
 INSERT INTO problem_tags SELECT NEW.id,value,ordinality-1 FROM jsonb_array_elements_text(NEW.public->'tags') WITH ORDINALITY;
 UPDATE problems SET current_version_id=NEW.id WHERE id=NEW.problem_id AND (current_version_id IS NULL OR (SELECT version FROM problem_versions WHERE id=current_version_id)<NEW.version);
 RETURN NEW;
END $$;
