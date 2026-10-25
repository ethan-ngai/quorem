ALTER TABLE interviews ADD COLUMN deleted_at timestamptz;
ALTER TABLE interviews ADD CONSTRAINT interviews_deleted_closed CHECK(deleted_at IS NULL OR state='closed');
CREATE INDEX interviews_host_active ON interviews(host_id) WHERE state='active';
ALTER TABLE quota_overrides DROP CONSTRAINT quota_overrides_resource_check;
ALTER TABLE quota_overrides ADD CONSTRAINT quota_overrides_resource_check CHECK(resource IN ('guest_jobs','guest_seconds','guest_concurrency','interview_concurrency'));
