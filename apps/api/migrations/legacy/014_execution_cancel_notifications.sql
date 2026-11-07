-- Publish only committed cancellation requests; listeners recheck the fenced job.
CREATE FUNCTION notify_execution_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancel_requested AND NOT OLD.cancel_requested THEN
    PERFORM pg_notify('quorem_execution_cancel', NEW.id::text);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER execution_cancellation_notification AFTER UPDATE OF cancel_requested ON submissions
FOR EACH ROW EXECUTE FUNCTION notify_execution_cancellation();
