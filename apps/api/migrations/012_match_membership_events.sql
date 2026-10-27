CREATE TABLE membership_outbox (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  participant_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX unpublished_membership_events ON membership_outbox(sequence) WHERE published_at IS NULL;

CREATE FUNCTION notify_membership_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_membership_outbox', '');
  RETURN NULL;
END $$;
CREATE TRIGGER membership_outbox_notification AFTER INSERT ON membership_outbox
FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_outbox();

CREATE FUNCTION queue_match_membership_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO membership_outbox(participant_id)
  SELECT participant_id FROM users WHERE id = COALESCE(NEW.owner_id, OLD.owner_id);
  RETURN NULL;
END $$;
CREATE TRIGGER match_membership_reservation AFTER INSERT OR DELETE ON match_reservations
FOR EACH ROW EXECUTE FUNCTION queue_match_membership_reservation();

CREATE FUNCTION queue_match_membership_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO membership_outbox(participant_id)
  SELECT u.participant_id FROM match_reservations r JOIN users u ON u.id = r.owner_id
  WHERE r.match_id = NEW.match_id;
  RETURN NULL;
END $$;
CREATE TRIGGER match_membership_update AFTER INSERT ON match_outbox
FOR EACH ROW EXECUTE FUNCTION queue_match_membership_update();
