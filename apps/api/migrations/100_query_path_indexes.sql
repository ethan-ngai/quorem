-- All-state workspace lookups and owner-first match review history.
CREATE INDEX submissions_workspace_lookup ON submissions(workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX match_participants_owner_match ON match_participants(owner_id, match_id);

-- Submission retention probes and cascading outbox deletes.
CREATE INDEX execution_idempotency_submission ON execution_idempotency(submission_id);
CREATE INDEX cancellation_idempotency_submission ON cancellation_idempotency(submission_id);
CREATE INDEX submission_outbox_submission ON submission_outbox(submission_id);

-- Party deadlines search across socket topics.
CREATE INDEX realtime_presence_owner_expiry ON realtime_presence_leases(subject, expires_at);
