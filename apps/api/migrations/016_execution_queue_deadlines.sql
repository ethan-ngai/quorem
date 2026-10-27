-- Wake queue observers when a job's eligibility or terminal status changes.
DROP TRIGGER execution_jobs_wakeup ON execution_jobs;
CREATE TRIGGER execution_jobs_wakeup_insert AFTER INSERT ON execution_jobs
FOR EACH STATEMENT EXECUTE FUNCTION notify_execution_jobs();
CREATE TRIGGER execution_jobs_wakeup_delete AFTER DELETE ON execution_jobs
FOR EACH STATEMENT EXECUTE FUNCTION notify_execution_jobs();
CREATE TRIGGER execution_jobs_wakeup_update AFTER UPDATE OF available_at,lease_until,attempt_id,finished ON execution_jobs
FOR EACH ROW WHEN (
  OLD.available_at IS DISTINCT FROM NEW.available_at OR
  OLD.attempt_id IS DISTINCT FROM NEW.attempt_id OR
  OLD.finished IS DISTINCT FROM NEW.finished OR
  (OLD.lease_until IS NOT NULL AND (NEW.lease_until IS NULL OR NEW.lease_until < OLD.lease_until))
) EXECUTE FUNCTION notify_execution_jobs();
