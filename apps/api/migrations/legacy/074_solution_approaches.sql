-- Metadata belongs to an algorithm; language variants contain only executable code.
CREATE TABLE problem_solution_approaches (
 version_id uuid NOT NULL REFERENCES problem_versions(id) ON DELETE CASCADE,
 id text NOT NULL CHECK(id ~ '^[a-z][a-z0-9-]*$' AND length(id)<=64),
 ordinal integer NOT NULL CHECK(ordinal>=0),
 title text NOT NULL DEFAULT '',
 is_canonical boolean NOT NULL DEFAULT false,
 default_language text NOT NULL CHECK(default_language IN ('python','java','typescript','ocaml','postgresql')),
 explanation_markdown text NOT NULL,
 time_complexity text NOT NULL,
 space_complexity text NOT NULL,
 complexity_notes text NOT NULL,
 PRIMARY KEY(version_id,id), UNIQUE(version_id,ordinal)
);
CREATE UNIQUE INDEX problem_solution_approaches_canonical ON problem_solution_approaches(version_id) WHERE is_canonical;

-- Distinct explanations remain separate approaches. Language allocation/complexity
-- differences are preserved in shared notes, rather than silently discarded.
CREATE FUNCTION question_solution_approaches(primary_solution jsonb, additions jsonb) RETURNS jsonb LANGUAGE sql AS $$
 WITH entries AS (
  SELECT value AS v,(ordinality-1)::integer AS pos
  FROM jsonb_array_elements(jsonb_build_array(primary_solution) || COALESCE(additions,'[]')) WITH ORDINALITY
  WHERE jsonb_typeof(value)='object'
 ), grouped AS (
  SELECT COALESCE(v->>'explanationMarkdown','') AS explanation,min(pos) AS first_pos FROM entries GROUP BY 1
 ), defaults AS (
  SELECT DISTINCT ON (g.explanation) g.*,e.v AS base
  FROM grouped g JOIN entries e ON COALESCE(e.v->>'explanationMarkdown','')=g.explanation
  ORDER BY g.explanation,(e.pos=0) DESC,e.v->>'language'
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',CASE WHEN d.first_pos=0 THEN 'default' ELSE 'alternative-'||d.first_pos END,
  'title',CASE WHEN d.first_pos=0 THEN '' ELSE 'Alternative '||d.first_pos END,
  'defaultLanguage',COALESCE(d.base->>'language','python'),
  'explanationMarkdown',d.explanation,
  'timeComplexity',COALESCE(d.base->>'timeComplexity',''),
  'spaceComplexity',COALESCE(d.base->>'spaceComplexity',''),
  'complexityNotes',btrim(COALESCE(d.base->>'complexityNotes','') || COALESCE((SELECT string_agg(
    E'\n\n' || CASE e.v->>'language' WHEN 'python' THEN 'Python' WHEN 'java' THEN 'Java' WHEN 'typescript' THEN 'TypeScript' WHEN 'ocaml' THEN 'OCaml' ELSE 'PostgreSQL' END || ': ' ||
    CASE WHEN ROW(COALESCE(e.v->>'timeComplexity',''),COALESCE(e.v->>'spaceComplexity','')) IS DISTINCT FROM ROW(COALESCE(d.base->>'timeComplexity',''),COALESCE(d.base->>'spaceComplexity',''))
     THEN 'Time '||COALESCE(e.v->>'timeComplexity','')||'; auxiliary space '||COALESCE(e.v->>'spaceComplexity','')||'. ' ELSE '' END ||
    CASE WHEN COALESCE(e.v->>'complexityNotes','')<>COALESCE(d.base->>'complexityNotes','') THEN COALESCE(e.v->>'complexityNotes','') ELSE '' END,
    '' ORDER BY e.v->>'language') FROM entries e WHERE COALESCE(e.v->>'explanationMarkdown','')=d.explanation AND e.v->>'language'<>d.base->>'language'
    AND ROW(COALESCE(e.v->>'timeComplexity',''),COALESCE(e.v->>'spaceComplexity',''),COALESCE(e.v->>'complexityNotes','')) IS DISTINCT FROM ROW(COALESCE(d.base->>'timeComplexity',''),COALESCE(d.base->>'spaceComplexity',''),COALESCE(d.base->>'complexityNotes',''))),'')),
  'implementations',(SELECT jsonb_agg(jsonb_build_object('language',e.v->>'language','source',COALESCE(e.v->>'source','')) ORDER BY e.v->>'language') FROM entries e WHERE COALESCE(e.v->>'explanationMarkdown','')=d.explanation)
 ) ORDER BY d.first_pos),'[]') FROM defaults d
$$;
CREATE TEMP TABLE migrated_solution_approaches ON COMMIT DROP AS
 SELECT v.id AS version_id,question_solution_approaches(
  (SELECT jsonb_build_object('language',s.language,'source',s.source,'explanationMarkdown',s.explanation_markdown,'timeComplexity',s.time_complexity,'spaceComplexity',s.space_complexity,'complexityNotes',s.complexity_notes) FROM problem_solutions s WHERE s.version_id=v.id AND s.language=CASE WHEN v.sql_config IS NULL THEN 'python' ELSE 'postgresql' END),
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('language',s.language,'source',s.source,'explanationMarkdown',s.explanation_markdown,'timeComplexity',s.time_complexity,'spaceComplexity',s.space_complexity,'complexityNotes',s.complexity_notes) ORDER BY s.language),'[]') FROM problem_solutions s WHERE s.version_id=v.id AND s.language<>CASE WHEN v.sql_config IS NULL THEN 'python' ELSE 'postgresql' END)
 ) AS approaches FROM problem_versions v;
INSERT INTO problem_solution_approaches
 SELECT m.version_id,a->>'id',ordinality-1,a->>'title',(a->>'id'='default'),a->>'defaultLanguage',a->>'explanationMarkdown',a->>'timeComplexity',a->>'spaceComplexity',a->>'complexityNotes'
 FROM migrated_solution_approaches m,LATERAL jsonb_array_elements(m.approaches) WITH ORDINALITY x(a,ordinality);
ALTER TABLE problem_solutions DISABLE TRIGGER immutable_problem_solution;
ALTER TABLE problem_solutions DISABLE TRIGGER sealed_problem_solution;
ALTER TABLE problem_solutions ADD COLUMN approach_id text;
UPDATE problem_solutions s SET approach_id=a->>'id'
 FROM migrated_solution_approaches m,LATERAL jsonb_array_elements(m.approaches) a
 WHERE s.version_id=m.version_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(a->'implementations') i WHERE i->>'language'=s.language);
ALTER TABLE problem_solutions ALTER COLUMN approach_id SET NOT NULL;
ALTER TABLE problem_solutions DROP CONSTRAINT problem_solutions_pkey;
ALTER TABLE problem_solutions ADD PRIMARY KEY(version_id,approach_id,language);
ALTER TABLE problem_solutions ADD CONSTRAINT problem_solutions_approach_fkey FOREIGN KEY(version_id,approach_id) REFERENCES problem_solution_approaches(version_id,id) ON DELETE CASCADE;
ALTER TABLE problem_solutions DROP COLUMN explanation_markdown,DROP COLUMN time_complexity,DROP COLUMN space_complexity,DROP COLUMN complexity_notes;
ALTER TABLE problem_solutions ENABLE TRIGGER immutable_problem_solution;
ALTER TABLE problem_solutions ENABLE TRIGGER sealed_problem_solution;
CREATE TRIGGER immutable_problem_solution_approach BEFORE UPDATE ON problem_solution_approaches FOR EACH ROW EXECUTE FUNCTION immutable_problem_content();
CREATE TRIGGER sealed_problem_solution_approach BEFORE INSERT OR UPDATE OR DELETE ON problem_solution_approaches FOR EACH ROW EXECUTE FUNCTION guard_sealed_problem_child();

CREATE FUNCTION question_approach_fields(doc json) RETURNS json LANGUAGE sql AS $$
 WITH converted AS (SELECT question_solution_approaches((doc->'canonicalSolution')::jsonb,(doc->'solutions')::jsonb) AS approaches)
 SELECT json_object_agg(key,value) FROM (
  SELECT key,value FROM json_each(doc) WHERE key NOT IN ('canonicalSolution','solutions')
  UNION ALL SELECT 'canonicalApproachId',to_json(CASE WHEN jsonb_array_length(approaches)>0 THEN 'default' ELSE '' END) FROM converted
  UNION ALL SELECT 'approaches',approaches::json FROM converted
 ) fields
$$;
CREATE FUNCTION question_approach_content(doc text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE marker text := '__quorem_nul_' || md5(doc) || '__'; masked text;
BEGIN
 WHILE strpos(doc,marker)>0 LOOP marker:=marker || '_'; END LOOP;
 masked:=regexp_replace(doc,$pattern$(?<!\\)((?:\\\\)*)\\u0000$pattern$,'\1' || marker,'g');
 RETURN replace(question_approach_fields(masked::json)::text,marker,$escape$\u0000$escape$);
END $$;
SELECT set_config('quorem.lossless_case_write','v1',true);
UPDATE question_drafts SET content=question_approach_content(content::text)::jsonb,
 lossless_content=CASE WHEN lossless_content IS NULL THEN NULL ELSE convert_to(question_approach_content(convert_from(lossless_content,'UTF8')),'UTF8') END,
 revision=revision+1,import_digest=NULL;
DROP FUNCTION question_approach_content(text);
DROP FUNCTION question_approach_fields(json);
DROP FUNCTION question_solution_approaches(jsonb,jsonb);
