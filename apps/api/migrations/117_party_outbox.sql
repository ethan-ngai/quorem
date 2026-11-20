CREATE TABLE party_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  dispatch_token uuid,
  dispatch_until timestamptz
);

CREATE INDEX party_outbox_pending ON party_outbox (sequence) WHERE published_at IS NULL;

CREATE FUNCTION notify_party_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version OR NEW.disbanded_at IS DISTINCT FROM OLD.disbanded_at THEN
    INSERT INTO public.party_outbox(party_id) VALUES(NEW.id);
    PERFORM pg_notify('quorem_party_outbox', '');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_party_snapshot
AFTER UPDATE OF version, disbanded_at ON parties
FOR EACH ROW EXECUTE FUNCTION notify_party_snapshot();
