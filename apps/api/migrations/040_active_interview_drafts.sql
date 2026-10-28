-- The live document is authoritative for the active question and language.
DELETE FROM interview_language_drafts d USING interviews i
WHERE d.session_id=i.id AND d.question_epoch=i.question_epoch AND d.language=i.language;
