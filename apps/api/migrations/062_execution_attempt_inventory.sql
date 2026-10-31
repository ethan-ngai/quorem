-- No historical coverage is inferred or backfilled by this migration.
CREATE TABLE execution_attempt_inventory (
 attempt_id uuid PRIMARY KEY,
 job_id uuid NOT NULL,
 sandbox_scope text NOT NULL CHECK (octet_length(sandbox_scope) BETWEEN 1 AND 256),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX execution_attempt_inventory_scope_attempt_idx ON execution_attempt_inventory(sandbox_scope, attempt_id);
REVOKE ALL ON execution_attempt_inventory FROM PUBLIC;

-- The claim and its immutable authority are committed or rolled back together.
CREATE FUNCTION record_execution_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id THEN
  IF NEW.attempt_id IS NOT NULL AND NEW.sandbox_scope IS DISTINCT FROM OLD.sandbox_scope THEN
   RAISE EXCEPTION 'attempt scope is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.attempt_id IS NOT NULL THEN
  INSERT INTO public.execution_attempt_inventory(attempt_id,job_id,sandbox_scope)
  VALUES(NEW.attempt_id,NEW.id,NEW.sandbox_scope);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_attempt_inventory_record AFTER INSERT OR UPDATE OF attempt_id,sandbox_scope ON execution_jobs
 FOR EACH ROW EXECUTE FUNCTION record_execution_attempt();

CREATE FUNCTION guard_execution_attempt_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'attempt inventory is immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER execution_attempt_inventory_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON execution_attempt_inventory
 FOR EACH STATEMENT EXECUTE FUNCTION guard_execution_attempt_inventory();
