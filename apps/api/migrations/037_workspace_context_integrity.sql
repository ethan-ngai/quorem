DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM submissions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.match_id IS DISTINCT FROM w.match_id)
  OR EXISTS (SELECT 1 FROM match_participants p JOIN workspaces w ON w.id=p.workspace_id WHERE p.match_id IS DISTINCT FROM w.match_id) THEN
  RAISE EXCEPTION 'Workspace match context differs from its consumer';
 END IF;
END $$;

CREATE FUNCTION guard_workspace_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.owner_id,NEW.problem_version_id,NEW.language,NEW.kind,NEW.match_id)
    IS DISTINCT FROM (OLD.owner_id,OLD.problem_version_id,OLD.language,OLD.kind,OLD.match_id) THEN
  RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_workspace_identity BEFORE UPDATE OF owner_id,problem_version_id,language,kind,match_id ON workspaces
FOR EACH ROW EXECUTE FUNCTION guard_workspace_identity();

CREATE FUNCTION guard_workspace_match_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_match uuid;
BEGIN
 IF NEW.workspace_id IS NOT NULL THEN
  SELECT match_id INTO workspace_match FROM workspaces WHERE id=NEW.workspace_id;
  IF workspace_match IS DISTINCT FROM NEW.match_id THEN
   RAISE EXCEPTION 'Workspace match context differs from its consumer' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submission_workspace_match BEFORE INSERT OR UPDATE OF workspace_id,match_id ON submissions
FOR EACH ROW EXECUTE FUNCTION guard_workspace_match_context();
CREATE TRIGGER participant_workspace_match BEFORE INSERT OR UPDATE OF workspace_id,match_id ON match_participants
FOR EACH ROW EXECUTE FUNCTION guard_workspace_match_context();
