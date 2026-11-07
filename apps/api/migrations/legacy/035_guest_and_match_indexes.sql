CREATE INDEX guest_usage_active_sponsor ON guest_execution_usage(sponsor_id) WHERE settled_at IS NULL;
CREATE INDEX match_idempotency_expiry ON match_idempotency(expires_at);
