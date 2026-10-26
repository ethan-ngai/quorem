-- Exclude revoked grant history from per-command feature authorization.
CREATE INDEX entitlement_grants_unrevoked ON entitlement_grants (user_id, feature) WHERE revoked_at IS NULL;

-- Current-question results must not scan every previous question's executions.
CREATE INDEX interview_execution_question ON interview_execution (session_id, question_epoch, submission_id);
