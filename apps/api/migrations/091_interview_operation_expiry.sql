ALTER TABLE interview_operations ADD COLUMN expires_at timestamptz;
CREATE INDEX interview_operations_expiry ON interview_operations(expires_at) WHERE expires_at IS NOT NULL;
