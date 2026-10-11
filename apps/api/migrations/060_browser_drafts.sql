-- Drafts live in the browser; submission snapshots remain for judging.
DROP TABLE IF EXISTS draft_sessions;
DROP TABLE IF EXISTS draft_versions;
ALTER TABLE workspaces DROP COLUMN IF EXISTS source;
ALTER TABLE workspaces DROP COLUMN IF EXISTS revision;
