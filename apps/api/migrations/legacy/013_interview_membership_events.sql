CREATE FUNCTION queue_interview_membership_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_session uuid; new_session uuid; old_user text; new_user text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role AND NEW.removed_at IS NOT DISTINCT FROM OLD.removed_at
      AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    old_session := OLD.session_id;
    old_user := OLD.user_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_session := NEW.session_id;
    new_user := NEW.user_id;
  END IF;
  INSERT INTO membership_outbox(participant_id)
  SELECT u.participant_id FROM users u
  WHERE u.kind = 'account' AND u.id IN (
    SELECT old_user UNION SELECT new_user
    UNION SELECT m.user_id FROM interview_members m
      WHERE m.session_id IN (old_session, new_session) AND m.removed_at IS NULL
  );
  RETURN NULL;
END $$;

CREATE TRIGGER interview_membership_change AFTER INSERT OR UPDATE OR DELETE ON interview_members
FOR EACH ROW EXECUTE FUNCTION queue_interview_membership_change();

CREATE FUNCTION queue_interview_hub_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO membership_outbox(participant_id)
  SELECT u.participant_id FROM interview_members m JOIN users u ON u.id = m.user_id
  WHERE m.session_id = NEW.id AND m.removed_at IS NULL AND u.kind = 'account';
  RETURN NULL;
END $$;

CREATE TRIGGER interview_hub_change AFTER UPDATE OF title, state, deleted_at, question ON interviews
FOR EACH ROW WHEN (
  OLD.title IS DISTINCT FROM NEW.title OR OLD.state IS DISTINCT FROM NEW.state OR
  OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR OLD.question IS DISTINCT FROM NEW.question
) EXECUTE FUNCTION queue_interview_hub_change();
