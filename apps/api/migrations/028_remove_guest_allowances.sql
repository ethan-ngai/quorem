ALTER TABLE matches DROP COLUMN guest_job_limit, DROP COLUMN guest_seconds_limit;
DELETE FROM quota_overrides WHERE resource IN ('guest_jobs','guest_seconds');
ALTER TABLE quota_overrides DROP CONSTRAINT quota_overrides_resource_check;
ALTER TABLE quota_overrides ADD CONSTRAINT quota_overrides_resource_check
 CHECK (resource IN ('guest_concurrency','interview_concurrency'));
