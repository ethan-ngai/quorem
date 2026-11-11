CREATE TABLE runner_blob_rechecks (hash bytea PRIMARY KEY);

-- Queue only new blobs and hashes whose references changed. The upsert serializes
-- a concurrent reference removal with the worker acknowledging the same hash.
CREATE FUNCTION public.queue_runner_blob_rechecks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  EXECUTE format(
    'INSERT INTO public.runner_blob_rechecks(hash) SELECT DISTINCT hash FROM (%s) candidates ORDER BY hash ON CONFLICT(hash) DO UPDATE SET hash=excluded.hash',
    CASE WHEN TG_NARGS=2
         THEN format('SELECT %I AS hash FROM changed UNION ALL SELECT %I FROM changed',TG_ARGV[0],TG_ARGV[1])
         ELSE format('SELECT %I AS hash FROM changed',TG_ARGV[0]) END
  );
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.queue_runner_blob_rechecks() FROM PUBLIC;

CREATE TRIGGER runner_blob_recheck_insert AFTER INSERT ON runner_input_blobs
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('hash');
CREATE TRIGGER runner_publication_recheck_delete AFTER DELETE ON runner_publication_inputs
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('metadata_hash');
CREATE TRIGGER runner_snapshot_recheck_delete AFTER DELETE ON runner_snapshot_inputs
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('metadata_hash');
CREATE TRIGGER runner_job_recheck_delete AFTER DELETE ON runner_job_inputs
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('metadata_hash','source_hash');
CREATE TRIGGER runner_publication_cases_recheck_delete AFTER DELETE ON runner_publication_input_cases
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('blob_hash');
CREATE TRIGGER runner_snapshot_cases_recheck_delete AFTER DELETE ON runner_snapshot_input_cases
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('blob_hash');
CREATE TRIGGER runner_job_cases_recheck_delete AFTER DELETE ON runner_job_input_cases
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION queue_runner_blob_rechecks('blob_hash');

-- Queue existing orphans once. The previous release's cursor stays readable during rollout.
INSERT INTO runner_blob_rechecks(hash)
SELECT b.hash FROM runner_input_blobs b
WHERE NOT EXISTS (SELECT FROM runner_publication_inputs x WHERE x.metadata_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_snapshot_inputs x WHERE x.metadata_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_job_inputs x WHERE x.metadata_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_job_inputs x WHERE x.source_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_publication_input_cases x WHERE x.blob_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_snapshot_input_cases x WHERE x.blob_hash=b.hash)
  AND NOT EXISTS (SELECT FROM runner_job_input_cases x WHERE x.blob_hash=b.hash);
