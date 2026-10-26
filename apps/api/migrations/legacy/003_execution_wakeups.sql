-- Notifications are transactional wakeups; execution_jobs and leases remain authoritative.
CREATE FUNCTION notify_execution_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quorem_execution_jobs', '');
  RETURN NULL;
END;
$$;
CREATE TRIGGER execution_jobs_wakeup AFTER INSERT OR UPDATE OF available_at ON execution_jobs
FOR EACH STATEMENT EXECUTE FUNCTION notify_execution_jobs();
