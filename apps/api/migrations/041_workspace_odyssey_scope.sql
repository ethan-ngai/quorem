-- Application-created workspaces use their own ID as the Odyssey scope.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE odyssey_scope IS NOT NULL AND odyssey_scope <> id) THEN
    RAISE EXCEPTION 'workspace Odyssey scopes require reconciliation before removal';
  END IF;
END $$;
ALTER TABLE workspaces DROP COLUMN odyssey_scope;
