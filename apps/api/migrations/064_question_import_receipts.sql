ALTER TABLE question_drafts ADD COLUMN import_digest text;
CREATE UNIQUE INDEX question_drafts_import_digest
  ON question_drafts (created_by, import_digest)
  WHERE import_digest IS NOT NULL;
