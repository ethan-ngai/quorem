-- Runtime and visibility metadata are derived from implementations and publication.
UPDATE question_drafts
SET content = jsonb_set(content, '{problem}', (content->'problem') - ARRAY['starterSource','runtimeRevision','languages','isPrivate','solutionLanguages','complexityLanguages'])
WHERE jsonb_typeof(content->'problem') = 'object'
  AND (content->'problem') ?| ARRAY['starterSource','runtimeRevision','languages','isPrivate','solutionLanguages','complexityLanguages'];
