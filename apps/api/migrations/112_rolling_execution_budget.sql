ALTER TABLE users ADD COLUMN admission_budget_job_id uuid;

ALTER TABLE execution_jobs
  ADD COLUMN budget_reserved_seconds double precision,
  ADD COLUMN budget_used_seconds double precision NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.meter_guest_execution() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  metered_guest boolean;
  finishing boolean := NEW.finished AND NOT OLD.finished;
  changing_attempt boolean := NEW.attempt_id IS DISTINCT FROM OLD.attempt_id;
  measured_at timestamptz := clock_timestamp();
  terminal_state text;
BEGIN
  IF NOT (finishing OR changing_attempt) THEN RETURN NEW; END IF;
  metered_guest := EXISTS (SELECT 1 FROM guest_execution_usage WHERE submission_id = OLD.submission_id);
  IF NOT metered_guest AND OLD.budget_reserved_seconds IS NULL THEN RETURN NEW; END IF;

  IF OLD.attempt_id IS NOT NULL AND OLD.attempt_started_at IS NOT NULL THEN
    IF metered_guest THEN
      INSERT INTO execution_attempt_usage(attempt_id, submission_id, seconds)
      VALUES (OLD.attempt_id, OLD.submission_id, GREATEST(0, CEIL(EXTRACT(EPOCH FROM measured_at - OLD.attempt_started_at)))::integer)
      ON CONFLICT DO NOTHING;
    END IF;
    IF OLD.budget_reserved_seconds IS NOT NULL AND NOT (
      changing_attempt AND NOT finishing AND NEW.attempt_id IS NULL AND EXISTS (
        SELECT 1 FROM execution_completion_receipts
        WHERE job_id = OLD.id AND attempt_id = OLD.attempt_id
          AND sandbox_scope = OLD.sandbox_scope AND outcome = 'requeued'
      )
    ) THEN
      -- An abandoned attempt stops consuming its allowance at lease expiry.
      NEW.budget_used_seconds := OLD.budget_used_seconds +
        GREATEST(1, EXTRACT(EPOCH FROM LEAST(measured_at, OLD.lease_until) - OLD.attempt_started_at));
    END IF;
  END IF;

  IF changing_attempt THEN
    NEW.attempt_started_at := CASE WHEN NEW.attempt_id IS NOT NULL THEN measured_at END;
  END IF;

  IF finishing THEN
    SELECT state INTO terminal_state FROM submissions WHERE id = NEW.submission_id;
    IF OLD.budget_reserved_seconds IS NOT NULL THEN
      -- Even a queued cancellation consumes admission capacity.
      NEW.budget_used_seconds := CASE WHEN terminal_state = 'failed' THEN 0
        ELSE GREATEST(1, NEW.budget_used_seconds) END;
    END IF;
    IF metered_guest THEN
      UPDATE guest_execution_usage
      SET charged_seconds = CASE WHEN terminal_state = 'completed' THEN
        COALESCE((SELECT SUM(seconds) FROM execution_attempt_usage WHERE submission_id = NEW.submission_id), 0)
        ELSE 0 END,
        settled_at = measured_at
      WHERE submission_id = NEW.submission_id AND settled_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
