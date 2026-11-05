CREATE INDEX submission_practice_latest ON submissions(workspace_id,odyssey_level,admitted_at,id)
 WHERE match_id IS NULL AND kind='submit' AND state='completed';
