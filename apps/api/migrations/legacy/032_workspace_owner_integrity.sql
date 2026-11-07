ALTER TABLE workspaces ADD CONSTRAINT workspace_owner_identity UNIQUE (id,owner_id);
ALTER TABLE submissions DROP CONSTRAINT submissions_workspace_id_fkey;
ALTER TABLE submissions ADD CONSTRAINT submission_workspace_owner_fkey
 FOREIGN KEY (workspace_id,owner_id) REFERENCES workspaces(id,owner_id);
ALTER TABLE match_participants DROP CONSTRAINT match_participants_workspace_id_fkey;
ALTER TABLE match_participants ADD CONSTRAINT match_participant_workspace_owner_fkey
 FOREIGN KEY (workspace_id,owner_id) REFERENCES workspaces(id,owner_id);
