-- Published content owns deduplication after the draft is consumed.
UPDATE question_drafts SET import_digest=NULL
 WHERE published_version_id IS NOT NULL AND import_digest IS NOT NULL;
