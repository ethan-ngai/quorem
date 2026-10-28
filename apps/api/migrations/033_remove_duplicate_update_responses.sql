UPDATE interview_operations SET response='null'::jsonb
WHERE jsonb_typeof(response)='object' AND response ? 'epoch' AND response ? 'version' AND response ? 'updates';
