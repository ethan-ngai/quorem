-- Notices commit atomically with changes, including writes made by the judge process.
CREATE TABLE interview_outbox (
 sequence bigserial PRIMARY KEY,
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
 event_type text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 published_at timestamptz
);
CREATE INDEX interview_outbox_pending ON interview_outbox(sequence) WHERE published_at IS NULL;

CREATE FUNCTION interview_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session uuid; kind text;
BEGIN
 kind := 'interview.session';
 IF TG_TABLE_NAME='interviews' THEN
  session := NEW.id;
  IF NEW.document_epoch=OLD.document_epoch AND NEW.document_version<>OLD.document_version THEN kind := 'interview.document'; END IF;
 ELSIF TG_TABLE_NAME='submissions' THEN
  kind := 'interview.result';
  SELECT session_id INTO session FROM interview_execution WHERE submission_id=NEW.id;
 ELSE
  IF TG_TABLE_NAME='interview_presence' THEN kind := 'interview.presence'; END IF;
  IF TG_TABLE_NAME='interview_execution' THEN kind := 'interview.result'; END IF;
  IF TG_OP='DELETE' THEN session := OLD.session_id; ELSE session := NEW.session_id; END IF;
 END IF;
 IF session IS NOT NULL THEN
  INSERT INTO interview_outbox(session_id,event_type) SELECT session,kind WHERE EXISTS(SELECT 1 FROM interviews WHERE id=session);
  PERFORM pg_notify('quorem_interview_outbox','');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER interview_realtime AFTER UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION interview_changed();
CREATE TRIGGER interview_member_realtime AFTER INSERT OR UPDATE ON interview_members FOR EACH ROW EXECUTE FUNCTION interview_changed();
CREATE TRIGGER interview_case_realtime AFTER INSERT OR DELETE ON interview_case_visibility FOR EACH ROW EXECUTE FUNCTION interview_changed();
CREATE TRIGGER interview_presence_realtime AFTER INSERT OR UPDATE OR DELETE ON interview_presence FOR EACH ROW EXECUTE FUNCTION interview_changed();
CREATE TRIGGER interview_execution_realtime AFTER INSERT OR UPDATE ON interview_execution FOR EACH ROW EXECUTE FUNCTION interview_changed();
CREATE TRIGGER interview_result_realtime AFTER UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION interview_changed();
