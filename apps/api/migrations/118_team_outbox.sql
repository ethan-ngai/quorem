CREATE TABLE team_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team smallint NOT NULL CHECK (team BETWEEN 1 AND 4),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  dispatch_token uuid,
  dispatch_until timestamptz
);

CREATE INDEX team_outbox_pending ON team_outbox (sequence) WHERE published_at IS NULL;

CREATE FUNCTION notify_team_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  target_team smallint;
  kind text := 'team.snapshot';
BEGIN
  IF TG_TABLE_NAME = 'submissions' THEN
    IF NEW.match_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT p.team INTO target_team FROM public.match_participants p
      JOIN public.match_teams t ON t.match_id=p.match_id AND t.team=p.team
      WHERE p.match_id=NEW.match_id AND p.owner_id=NEW.owner_id
        AND t.workspace_id=NEW.workspace_id;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  ELSE
    target_team := NEW.team;
    IF TG_TABLE_NAME = 'match_teams' THEN
      IF NEW.document_epoch IS NOT DISTINCT FROM OLD.document_epoch AND
         NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
        IF NEW.document_version IS NOT DISTINCT FROM OLD.document_version THEN
          RETURN NEW;
        END IF;
        kind := 'team.document';
      END IF;
    ELSIF TG_TABLE_NAME = 'team_document_presence' THEN
      IF TG_OP = 'UPDATE' AND NEW.payload = OLD.payload AND OLD.expires_at > clock_timestamp() THEN
        RETURN NEW;
      END IF;
      kind := 'team.presence';
    END IF;
  END IF;

  INSERT INTO public.team_outbox(match_id, team, event_type)
  VALUES(NEW.match_id, target_team, kind);
  PERFORM pg_notify('quorem_team_outbox', '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_team_document AFTER UPDATE OF document_version, document_epoch, workspace_id
ON match_teams FOR EACH ROW EXECUTE FUNCTION notify_team_change();
CREATE TRIGGER notify_team_vote AFTER INSERT OR UPDATE OF vote
ON team_votes FOR EACH ROW EXECUTE FUNCTION notify_team_change();
CREATE TRIGGER notify_team_presence AFTER INSERT OR UPDATE OF payload
ON team_document_presence FOR EACH ROW EXECUTE FUNCTION notify_team_change();
CREATE TRIGGER notify_team_submission AFTER INSERT ON submissions
FOR EACH ROW EXECUTE FUNCTION notify_team_change();
