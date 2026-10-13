DROP INDEX match_workspace_owner;
CREATE UNIQUE INDEX match_workspace_owner_language ON workspaces(match_id,owner_id,language) WHERE kind='match';
