-- Each epoch or immutable fixture owns one byte-preserving public array per level.
-- Level 0 contains top-level examples; Odyssey stages use levels 1..N.
CREATE TABLE interview_public_examples (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 question_epoch uuid NOT NULL,
 level integer NOT NULL CHECK (level >= 0),
 examples bytea NOT NULL,
 PRIMARY KEY (session_id, question_epoch, level)
);
CREATE TABLE interview_snapshot_public_examples (
 session_id uuid NOT NULL,
 fixture_id bytea NOT NULL,
 level integer NOT NULL CHECK (level >= 0),
 examples bytea NOT NULL,
 PRIMARY KEY (session_id, fixture_id, level),
 FOREIGN KEY (session_id, fixture_id) REFERENCES interview_question_snapshots(session_id,id) ON DELETE CASCADE
);
-- Private cases are individually addressable; candidate reads join explicit reveals.
CREATE TABLE interview_question_private_cases (
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 question_epoch uuid NOT NULL,
 case_id text NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 case_data bytea NOT NULL,
 PRIMARY KEY (session_id, question_epoch, case_id),
 UNIQUE (session_id, question_epoch, ordinal)
);
-- The view owner can read the fixture; application readers receive explicit public fields.
CREATE FUNCTION interview_public_signature(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'description',value->'description','returns',value->'returns','outputOrder',value->'outputOrder',
  'className',value->'className','methodName',value->'methodName','returnType',value->'returnType',
  'parameters',(SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',p->'name','type',p->'type','description',p->'description','input',CASE WHEN p->'input' IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('preset',p->'input'->'preset','placeholder',p->'input'->'placeholder','rows',p->'input'->'rows')) END)) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value->'parameters')='array' THEN value->'parameters' ELSE '[]'::jsonb END) WITH ORDINALITY t(p,n)),
  'throws',(SELECT jsonb_agg(jsonb_build_object('type',t->'type','description',t->'description') ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value->'throws')='array' THEN value->'throws' ELSE '[]'::jsonb END) WITH ORDINALITY v(t,n))
 ));
$$;
CREATE VIEW interview_question_public WITH (security_barrier=true) AS
 SELECT i.id AS session_id,i.question_epoch,
 jsonb_strip_nulls(jsonb_build_object('hints',i.question->'hints','problem',jsonb_strip_nulls(jsonb_build_object(
  'id',p->'id','slug',p->'slug','version',p->'version','title',p->'title','difficulty',p->'difficulty',
  'tags',p->'tags','companies',p->'companies','leetcodeId',p->'leetcodeId','statementMarkdown',p->'statementMarkdown',
  'signature',interview_public_signature(p->'signature'),'constraints',p->'constraints','limits',p->'limits','sql',p->'sql',
  'starterSource',p->'starterSource','runtimeRevision',p->'runtimeRevision',
  'languages',(SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('language',l->'language','starterSource',l->'starterSource','runtimeRevision',l->'runtimeRevision','harnessRevision',l->'harnessRevision')) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'languages')='array' THEN p->'languages' ELSE '[]'::jsonb END) WITH ORDINALITY langs(l,n)),
  'odyssey',CASE WHEN jsonb_typeof(p->'odyssey'->'levels')='array' THEN jsonb_build_object('levels',(SELECT COALESCE(jsonb_agg(jsonb_build_object('title',stage->'title','statementMarkdown',stage->'statementMarkdown','methods',(SELECT COALESCE(jsonb_agg(interview_public_signature(method) ORDER BY mn),'[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stage->'methods')='array' THEN stage->'methods' ELSE '[]'::jsonb END) WITH ORDINALITY ms(method,mn))) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(p->'odyssey'->'levels') WITH ORDINALITY ls(stage,n))) ELSE NULL END
 )))) AS metadata,
 CASE WHEN jsonb_typeof(p->'odyssey'->'levels')='array' THEN ARRAY(SELECT 'level:'||n::text||':case:'||idx::text FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.question->'odysseyHiddenCases')='array' THEN i.question->'odysseyHiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY stages(suite,n) CROSS JOIN LATERAL generate_series(0,jsonb_array_length(CASE WHEN jsonb_typeof(suite)='array' THEN suite ELSE '[]'::jsonb END)-1) idx ORDER BY n,idx)
 ELSE ARRAY(SELECT 'hidden:'||idx::text FROM generate_series(0,jsonb_array_length(CASE WHEN jsonb_typeof(i.question->'hiddenCases')='array' THEN i.question->'hiddenCases' ELSE '[]'::jsonb END)-1) idx ORDER BY idx) END AS private_ids
 FROM interviews i CROSS JOIN LATERAL (SELECT i.question->'problem' AS p) source;
-- Per-result rows let a candidate fetch only explicitly revealed case output.
CREATE TABLE interview_private_result_cases (
 submission_id uuid NOT NULL REFERENCES interview_execution(submission_id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 result_data bytea NOT NULL,
 PRIMARY KEY (submission_id,ordinal)
);
CREATE VIEW interview_snapshot_public WITH (security_barrier=true) AS
 SELECT q.session_id,q.id AS fixture_id,
 CASE WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels') ELSE 0 END AS total_stages,
 CASE WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' THEN ARRAY(SELECT 'level:'||n::text||':case:'||idx::text FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.fixture->'odysseyHiddenCases')='array' THEN q.fixture->'odysseyHiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY stages(suite,n) CROSS JOIN LATERAL generate_series(0,jsonb_array_length(CASE WHEN jsonb_typeof(suite)='array' THEN suite ELSE '[]'::jsonb END)-1) idx ORDER BY n,idx)
 ELSE ARRAY(SELECT 'hidden:'||idx::text FROM generate_series(0,jsonb_array_length(CASE WHEN jsonb_typeof(q.fixture->'hiddenCases')='array' THEN q.fixture->'hiddenCases' ELSE '[]'::jsonb END)-1) idx ORDER BY idx) END AS private_ids,
 jsonb_array_length(CASE WHEN jsonb_typeof(q.fixture->'problem'->'examples')='array' THEN q.fixture->'problem'->'examples' ELSE '[]'::jsonb END) AS example_count
 FROM interview_question_snapshots q;
CREATE VIEW interview_execution_public WITH (security_barrier=true) AS
 SELECT submission_id,session_id,question_epoch,fixture_id,level,
 CASE WHEN jsonb_typeof(private_results)='array' THEN jsonb_array_length(private_results) ELSE 0 END AS result_count,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('index',v->'index','status',v->'status') ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(private_results)='array' THEN private_results ELSE '[]'::jsonb END) WITH ORDINALITY r(v,n)) AS private_statuses
 FROM interview_execution;
