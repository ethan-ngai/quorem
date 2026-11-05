-- Consolidate source into editorials without changing existing published editorials or
-- admitted fixture identities. Only immutable hashes of retired references remain.
ALTER TABLE problem_languages ADD COLUMN reference_source_hash bytea;
ALTER TABLE problem_languages DISABLE TRIGGER immutable_problem_language;
ALTER TABLE problem_languages DISABLE TRIGGER sealed_problem_language;
UPDATE problem_languages SET reference_source_hash=sha256(decode('01','hex') || convert_to(reference_source,'UTF8'));
ALTER TABLE problem_languages ENABLE TRIGGER immutable_problem_language;
ALTER TABLE problem_languages ENABLE TRIGGER sealed_problem_language;
ALTER TABLE problem_languages ALTER COLUMN reference_source_hash SET NOT NULL;
ALTER TABLE problem_languages ALTER COLUMN reference_source_hash SET DEFAULT sha256(decode('01','hex'));
ALTER TABLE problem_languages ADD CONSTRAINT problem_language_reference_hash CHECK(octet_length(reference_source_hash)=32);

ALTER TABLE problem_solutions DISABLE TRIGGER sealed_problem_solution;
INSERT INTO problem_solutions(version_id,language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes)
 SELECT l.version_id,l.language,l.reference_source,'','','',''
 FROM problem_languages l JOIN problem_versions v ON v.id=l.version_id
 WHERE l.language=CASE WHEN v.sql_config IS NULL THEN 'python' ELSE 'postgresql' END
 AND btrim(l.reference_source) NOT IN ('','Private question uses explicit expected values')
 ON CONFLICT DO NOTHING;
ALTER TABLE problem_solutions ENABLE TRIGGER sealed_problem_solution;

-- JSON (not JSONB) preserves numeric lexemes and escaped NULs in lossless draft cases.
CREATE FUNCTION canonical_question_fields(doc json) RETURNS json LANGUAGE sql AS $$
 WITH primary_language AS (
  SELECT CASE WHEN doc->'problem'->'sql' IS NOT NULL AND doc->'problem'->>'sql'<>'null' THEN 'postgresql' ELSE 'python' END AS language
 ), canonical AS (
  SELECT jsonb_build_object('language',p.language,'source',COALESCE((SELECT i->>'referenceSource' FROM json_array_elements(COALESCE(doc->'implementations','[]')) i WHERE i->>'language'=p.language),''),'explanationMarkdown','','timeComplexity','','spaceComplexity','','complexityNotes','')
   || COALESCE((SELECT s::jsonb FROM json_array_elements(COALESCE(doc->'solutions','[]')) s WHERE s->>'language'=p.language),'{}'::jsonb) AS solution
  FROM primary_language p
 )
 SELECT json_object_agg(key,value) FROM (
  SELECT key,value FROM json_each(doc) WHERE key NOT IN ('implementations','solutions','canonicalSolution')
  UNION ALL SELECT 'canonicalSolution',solution::json FROM canonical
  UNION ALL SELECT 'implementations',COALESCE((SELECT json_agg(i::jsonb-'referenceSource') FROM json_array_elements(COALESCE(doc->'implementations','[]')) i),'[]'::json)
  UNION ALL SELECT 'solutions',COALESCE((SELECT json_agg(s) FROM json_array_elements(COALESCE(doc->'solutions','[]')) s WHERE s->>'language'<>(SELECT language FROM primary_language)),'[]'::json)
 ) fields
$$;
-- PostgreSQL JSON operators reject escaped NULs even when the untouched value is nested.
-- Mask actual JSON NUL escapes, preserving literal backslashes and existing marker text.
CREATE FUNCTION canonical_question_content(doc text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE marker text := '__quorem_nul_' || md5(doc) || '__'; masked text;
BEGIN
 WHILE strpos(doc,marker)>0 LOOP marker:=marker || '_'; END LOOP;
 masked:=regexp_replace(doc,$pattern$(?<!\\)((?:\\\\)*)\\u0000$pattern$,'\1' || marker,'g');
 RETURN replace(canonical_question_fields(masked::json)::text,marker,$escape$\u0000$escape$);
END $$;
SELECT set_config('quorem.lossless_case_write','v1',true);
UPDATE question_drafts SET content=canonical_question_content(content::text)::jsonb,
 lossless_content=CASE WHEN lossless_content IS NULL THEN NULL ELSE convert_to(canonical_question_content(convert_from(lossless_content,'UTF8')),'UTF8') END,
 revision=revision+1,import_digest=NULL;
DROP FUNCTION canonical_question_content(text);
DROP FUNCTION canonical_question_fields(json);
ALTER TABLE problem_languages DROP COLUMN reference_source;
