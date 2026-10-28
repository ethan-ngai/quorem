CREATE INDEX match_submission_history ON submissions (match_id, admitted_at, match_sequence)
 WHERE match_id IS NOT NULL AND kind='submit';
