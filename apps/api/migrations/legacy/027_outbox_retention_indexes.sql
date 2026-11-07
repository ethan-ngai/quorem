CREATE INDEX interview_guest_sessions_session ON interview_guest_sessions(session_id);
CREATE INDEX interview_outbox_retention ON interview_outbox(occurred_at,sequence) WHERE published_at IS NOT NULL;
CREATE INDEX match_outbox_retention ON match_outbox(occurred_at,sequence) WHERE published_at IS NOT NULL;
CREATE INDEX membership_outbox_retention ON membership_outbox(occurred_at,sequence) WHERE published_at IS NOT NULL;
CREATE INDEX submission_outbox_retention ON submission_outbox(occurred_at,sequence) WHERE published_at IS NOT NULL;
