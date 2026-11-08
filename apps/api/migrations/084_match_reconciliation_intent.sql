-- Enqueue under the fenced submission without taking a foreign-key lock on the match.
ALTER TABLE public.match_reconciliation_pending
  DROP CONSTRAINT match_reconciliation_pending_match_id_fkey,
  ADD COLUMN publish_update boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.queue_match_reconciliation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_id IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.match_reconciliation_pending(match_id) VALUES (NEW.match_id)
    ON CONFLICT(match_id) DO UPDATE
    SET generation=match_reconciliation_pending.generation+1, publish_update=true;
    PERFORM pg_notify('quorem_match_deadlines', '');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_finished_match_reconciliation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.match_reconciliation_pending WHERE match_id = OLD.id;
  ELSIF NEW.state IN ('completed', 'cancelled') THEN
    DELETE FROM public.match_reconciliation_pending WHERE match_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER finished_match_reconciliation ON public.matches;
CREATE TRIGGER finished_match_reconciliation
AFTER UPDATE OF state OR DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.clear_finished_match_reconciliation();
