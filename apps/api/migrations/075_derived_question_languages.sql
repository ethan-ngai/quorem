-- Preserve existing sealed fixture identities while retiring authored execution configuration.
ALTER TABLE problem_versions ADD COLUMN fixture_identity_hash bytea;
-- Preserve valid optimistic edit fences across this migration’s version rewrites.
CREATE TEMP TABLE question_state_edit_tokens ON COMMIT DROP AS SELECT id,xmin::text AS token FROM problem_versions;
ALTER TABLE problem_versions DISABLE TRIGGER immutable_problem_version;
UPDATE problem_versions target SET fixture_identity_hash = (SELECT COALESCE(sha256(v.lossless_fixture),sha256(
        convert_to('quorem-version-fixture-v1','UTF8') ||
        sha256(sha256(CASE WHEN (v.id) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.id)::text,'UTF8') END) || sha256(CASE WHEN (v.problem_id) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.problem_id)::text,'UTF8') END) || sha256(CASE WHEN (v.version) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.version)::text,'UTF8') END) || sha256(CASE WHEN (v.title) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.title)::text,'UTF8') END) || sha256(CASE WHEN (v.difficulty) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.difficulty)::text,'UTF8') END) || sha256(CASE WHEN (v.statement_markdown) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.statement_markdown)::text,'UTF8') END) || sha256(CASE WHEN (v.signature) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.signature)::text,'UTF8') END) || sha256(CASE WHEN (v.constraints) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.constraints)::text,'UTF8') END) || sha256(CASE WHEN (v.limits) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.limits)::text,'UTF8') END) || sha256(CASE WHEN (v.attribution) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.attribution)::text,'UTF8') END) || sha256(CASE WHEN (v.sql_config) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.sql_config)::text,'UTF8') END) || sha256(CASE WHEN (v.odyssey-'levels') IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((v.odyssey-'levels')::text,'UTF8') END)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (l.language) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((l.language)::text,'UTF8') END) || sha256(CASE WHEN (l.starter_source) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((l.starter_source)::text,'UTF8') END) || sha256(CASE WHEN (l.runtime_revision) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((l.runtime_revision)::text,'UTF8') END) || sha256(CASE WHEN (l.harness_revision) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((l.harness_revision)::text,'UTF8') END) || l.reference_source_hash),''::bytea ORDER BY l.language COLLATE "C") FROM problem_languages l WHERE l.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (t.ordinal) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((t.ordinal)::text,'UTF8') END) || sha256(CASE WHEN (t.tag) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((t.tag)::text,'UTF8') END)),''::bytea ORDER BY t.ordinal) FROM problem_tags t WHERE t.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (e.ordinal) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.ordinal)::text,'UTF8') END) || sha256(CASE WHEN (e.args) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.args)::text,'UTF8') END) || sha256(CASE WHEN (e.expected) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.expected)::text,'UTF8') END) || sha256(CASE WHEN (e.explanation) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.explanation)::text,'UTF8') END) || sha256(CASE WHEN (e.calls) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.calls)::text,'UTF8') END)),''::bytea ORDER BY e.ordinal) FROM problem_examples e WHERE e.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (c.ordinal) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.ordinal)::text,'UTF8') END) || sha256(CASE WHEN (c.args) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.args)::text,'UTF8') END) || sha256(CASE WHEN (c.expected) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.expected)::text,'UTF8') END) || sha256(CASE WHEN (c.calls) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.calls)::text,'UTF8') END)),''::bytea ORDER BY c.ordinal) FROM problem_test_cases c WHERE c.version_id=v.id),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (stage.ordinality-1) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((stage.ordinality-1)::text,'UTF8') END) || sha256(CASE WHEN (stage.value-'examples') IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((stage.value-'examples')::text,'UTF8') END)),''::bytea ORDER BY stage.ordinality) FROM jsonb_array_elements(COALESCE(v.odyssey->'levels','[]'::jsonb)) WITH ORDINALITY stage(value,ordinality)),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (stage.ordinality-1) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((stage.ordinality-1)::text,'UTF8') END) || sha256(CASE WHEN (e.ordinality-1) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.ordinality-1)::text,'UTF8') END) || sha256(CASE WHEN (e.value) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((e.value)::text,'UTF8') END)),''::bytea ORDER BY stage.ordinality,e.ordinality) FROM jsonb_array_elements(COALESCE(v.odyssey->'levels','[]'::jsonb)) WITH ORDINALITY stage(value,ordinality), LATERAL jsonb_array_elements(COALESCE(stage.value->'examples','[]'::jsonb)) WITH ORDINALITY e(value,ordinality)),''::bytea)) ||
        sha256(COALESCE((SELECT string_agg(sha256(sha256(CASE WHEN (c.level) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.level)::text,'UTF8') END) || sha256(CASE WHEN (c.ordinal) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.ordinal)::text,'UTF8') END) || sha256(CASE WHEN (c.case_data) IS NULL THEN decode('00','hex') ELSE decode('01','hex') || convert_to((c.case_data)::text,'UTF8') END)),''::bytea ORDER BY c.level,c.ordinal) FROM problem_odyssey_cases c WHERE c.version_id=v.id),''::bytea))
      )) AS hash FROM problem_versions v WHERE v.id=target.id);
ALTER TABLE problem_versions ALTER COLUMN signature DROP NOT NULL;
UPDATE problem_versions SET sql_config=NULL WHERE sql_config='null'::jsonb;
UPDATE problem_versions SET odyssey=NULL WHERE odyssey='null'::jsonb;
UPDATE problem_versions SET signature=NULL WHERE odyssey IS NOT NULL OR (sql_config IS NOT NULL AND sql_config<>'null'::jsonb);
ALTER TABLE problem_versions ENABLE TRIGGER immutable_problem_version;
ALTER TABLE problem_versions ADD CONSTRAINT problem_fixture_identity_hash CHECK(fixture_identity_hash IS NULL OR octet_length(fixture_identity_hash)=32);
ALTER TABLE problem_versions ADD CONSTRAINT problem_signature_owner CHECK(
 ((sql_config IS NULL OR sql_config='null'::jsonb) AND odyssey IS NULL AND signature IS NOT NULL)
 OR ((odyssey IS NOT NULL OR (sql_config IS NOT NULL AND sql_config<>'null'::jsonb)) AND signature IS NULL)
);
ALTER TABLE workspaces DROP CONSTRAINT workspace_problem_language_fkey;
ALTER TABLE workspaces ADD CONSTRAINT workspace_problem_version_fkey FOREIGN KEY(problem_version_id) REFERENCES problem_versions(id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE problem_solutions DROP CONSTRAINT problem_solutions_version_id_language_fkey;
DROP TABLE problem_languages;
ALTER TABLE problem_solutions ADD CONSTRAINT problem_solutions_language_check CHECK(language IN ('python','java','typescript','ocaml','postgresql'));

-- Compare native columns; JSON conversion expands bytea sidecars and exceeds JSONB limits.
CREATE OR REPLACE FUNCTION immutable_problem_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='problem_versions' THEN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid=TG_RELID AND attnum>0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','version','problem_id','title','difficulty','statement_markdown','signature','constraints','limits','attribution','sealed','sql_config','odyssey','lossless_fixture','lossless_public','lossless_stages','fixture_identity_hash']::text[]
  THEN RAISE EXCEPTION 'Problem version seal comparison requires schema update'; END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     ROW(NEW.id,NEW.version,NEW.problem_id,NEW.title,NEW.difficulty,NEW.statement_markdown,NEW.signature,NEW.constraints,NEW.limits,NEW.attribution,NEW.sql_config,NEW.odyssey,NEW.lossless_fixture,NEW.lossless_public,NEW.lossless_stages,NEW.fixture_identity_hash)
     IS NOT DISTINCT FROM
     ROW(OLD.id,OLD.version,OLD.problem_id,OLD.title,OLD.difficulty,OLD.statement_markdown,OLD.signature,OLD.constraints,OLD.limits,OLD.attribution,OLD.sql_config,OLD.odyssey,OLD.lossless_fixture,OLD.lossless_public,OLD.lossless_stages,OLD.fixture_identity_hash)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Use question authoring to edit published content' USING ERRCODE='23514';
END $$;

ALTER TABLE problem_solution_approaches ALTER COLUMN default_language DROP NOT NULL;
ALTER TABLE problem_solution_approaches DISABLE TRIGGER immutable_problem_solution_approach;
ALTER TABLE problem_solution_approaches DISABLE TRIGGER sealed_problem_solution_approach;
UPDATE problem_solution_approaches SET default_language=NULL WHERE is_canonical;
ALTER TABLE problem_solution_approaches ENABLE TRIGGER immutable_problem_solution_approach;
ALTER TABLE problem_solution_approaches ENABLE TRIGGER sealed_problem_solution_approach;
ALTER TABLE problem_solution_approaches DROP CONSTRAINT problem_solution_approaches_default_language_check;
ALTER TABLE problem_solution_approaches ADD CONSTRAINT problem_solution_approaches_default_language_check CHECK(
 (is_canonical AND default_language IS NULL) OR
 (NOT is_canonical AND default_language IS NOT NULL AND default_language IN ('python','java','typescript','ocaml','postgresql'))
);

-- Rewrite authored state without JSONB round-tripping lossless case number/string spellings.
CREATE FUNCTION question_owned_fields(doc json) RETURNS json LANGUAGE plpgsql AS $$
DECLARE p json := doc->'problem'; od json := p->'odyssey'; stage json; item json;
        stages text[] := ARRAY[]::text[]; approaches text[] := ARRAY[]::text[];
        owned text; hidden json; n integer := 0; staged boolean;
BEGIN
 staged := od IS NOT NULL AND od::text<>'null';
 IF staged THEN
  FOR stage IN SELECT value FROM json_array_elements(COALESCE(od->'levels','[]'::json)) LOOP
   hidden := COALESCE(stage->'hiddenCases',doc->'odysseyHiddenCases'->n,'[]'::json);
   SELECT '{'||COALESCE(string_agg(to_json(key)::text||':'||value::text,','),'')||
     CASE WHEN count(*)>0 THEN ',' ELSE '' END||'"hiddenCases":'||hidden::text||'}'
   INTO owned FROM json_each(stage) WHERE key<>'hiddenCases';
   stages := array_append(stages,owned); n:=n+1;
  END LOOP;
  od := ('{"levels":['||array_to_string(stages,',')||']}')::json;
 END IF;
 SELECT ('{'||COALESCE(string_agg(to_json(key)::text||':'||
   CASE WHEN key='odyssey' AND staged THEN od::text ELSE value::text END,','),'')||'}')::json
 INTO p FROM json_each(p) WHERE NOT (key='signature' AND
   (staged OR (p->'sql' IS NOT NULL AND (p->'sql')::text<>'null')));
 FOR item IN SELECT value FROM json_array_elements(COALESCE(doc->'approaches','[]'::json)) LOOP
  SELECT '{'||COALESCE(string_agg(to_json(key)::text||':'||value::text,','),'')||'}'
  INTO owned FROM json_each(item) WHERE NOT(key='defaultLanguage' AND item->>'id'=doc->>'canonicalApproachId');
  approaches:=array_append(approaches,owned);
 END LOOP;
 SELECT ('{'||string_agg(to_json(key)::text||':'||CASE
   WHEN key='problem' THEN p::text
   WHEN key='approaches' THEN '['||array_to_string(approaches,',')||']'
   ELSE value::text END,',')||'}')::json
 INTO item FROM json_each(doc) WHERE key NOT IN ('implementations','odysseyHiddenCases');
 RETURN item;
END $$;
CREATE FUNCTION question_owned_content(doc text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE marker text := '__quorem_nul_' || md5(doc) || '__'; masked text;
BEGIN
 WHILE strpos(doc,marker)>0 LOOP marker:=marker || '_'; END LOOP;
 masked:=regexp_replace(doc,$pattern$(?<!\\)((?:\\\\)*)\\u0000$pattern$,'\1' || marker,'g');
 RETURN replace(question_owned_fields(masked::json)::text,marker,$escape$\u0000$escape$);
END $$;
SELECT set_config('quorem.lossless_case_write','v1',true);
UPDATE question_drafts SET content=question_owned_content(content::text)::jsonb,
 lossless_content=CASE WHEN lossless_content IS NULL THEN NULL ELSE convert_to(question_owned_content(convert_from(lossless_content,'UTF8')),'UTF8') END,
 revision=revision+1,import_digest=NULL;
DROP FUNCTION question_owned_content(text);
DROP FUNCTION question_owned_fields(json);

UPDATE question_drafts d SET edit_base=v.xmin::text
FROM problem_versions v,question_state_edit_tokens prior
WHERE d.edit_version_id=v.id AND prior.id=v.id AND d.edit_base=prior.token;
