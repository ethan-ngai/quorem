ALTER TABLE parties ADD COLUMN team_count smallint NOT NULL DEFAULT 2 CHECK (team_count BETWEEN 2 AND 4);
ALTER TABLE party_members ADD COLUMN team smallint CHECK (team BETWEEN 1 AND 4);
ALTER TABLE match_participants ADD COLUMN team smallint CHECK (team BETWEEN 1 AND 4);
ALTER TABLE matches DROP CONSTRAINT matches_mode_check;
ALTER TABLE matches ADD CONSTRAINT matches_mode_check CHECK (mode IN ('showdown','free-for-all','factions'));
CREATE TABLE match_teams (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team smallint NOT NULL CHECK (team BETWEEN 1 AND 4),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT '',
  document_version bigint NOT NULL DEFAULT 0 CHECK (document_version >= 0),
  document_epoch uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (match_id, team)
);
CREATE TABLE team_document_updates (
  match_id uuid NOT NULL,
  team smallint NOT NULL,
  epoch uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  client_id text NOT NULL,
  changes jsonb NOT NULL,
  PRIMARY KEY (match_id,team,epoch,version),
  FOREIGN KEY (match_id,team) REFERENCES match_teams(match_id,team) ON DELETE CASCADE
);
CREATE TABLE team_votes (
  id uuid PRIMARY KEY,
  match_id uuid NOT NULL,
  team smallint NOT NULL,
  vote jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (match_id,team) REFERENCES match_teams(match_id,team) ON DELETE CASCADE
);
CREATE INDEX team_votes_team ON team_votes(match_id,team,created_at DESC);
CREATE TABLE team_document_presence (
  match_id uuid NOT NULL,
  team smallint NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(match_id,team,owner_id,client_id),
  FOREIGN KEY (match_id,team) REFERENCES match_teams(match_id,team) ON DELETE CASCADE
);
ALTER TABLE workspaces ADD COLUMN team smallint CHECK (team BETWEEN 1 AND 4);
ALTER TABLE workspaces ADD CONSTRAINT workspace_team_context CHECK (team IS NULL OR (kind='match' AND match_id IS NOT NULL));
ALTER TABLE submissions DROP CONSTRAINT submission_workspace_owner_fkey;
ALTER TABLE match_participants DROP CONSTRAINT match_participant_workspace_owner_fkey;
CREATE FUNCTION guard_team_workspace_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_workspace uuid;
BEGIN
  -- Deferred checks validate the final row, not an intermediate workspace replaced in this transaction.
  IF TG_TABLE_NAME='submissions' THEN
    SELECT workspace_id INTO current_workspace FROM submissions WHERE id=NEW.id;
  ELSE
    SELECT workspace_id INTO current_workspace FROM match_participants WHERE match_id=NEW.match_id AND owner_id=NEW.owner_id;
  END IF;
  IF NOT FOUND OR current_workspace IS DISTINCT FROM NEW.workspace_id THEN RETURN NEW; END IF;
  IF NEW.workspace_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (
      (w.team IS NULL AND w.owner_id=NEW.owner_id) OR
      (w.team IS NOT NULL AND w.match_id=NEW.match_id AND EXISTS (
        SELECT 1 FROM match_participants p WHERE p.match_id=w.match_id AND p.owner_id=NEW.owner_id AND p.team=w.team
      ))
    )
  ) THEN RAISE EXCEPTION 'Workspace must belong to actor or admitted team' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER submission_workspace_access AFTER INSERT OR UPDATE OF workspace_id,owner_id,match_id ON submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_team_workspace_access();
CREATE CONSTRAINT TRIGGER participant_workspace_access AFTER INSERT OR UPDATE OF workspace_id,owner_id,match_id,team ON match_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_team_workspace_access();
