BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

-- Include Runs and submissions that never reached a runner.
SELECT s.id AS submission, s.kind, s.state, s.result->>'verdict' AS verdict,
       s.admitted_at, s.updated_at,
       s.cancel_requested, j.finished, j.lease_until,
       (SELECT min(k.expires_at) - interval '24 hours'
        FROM cancellation_idempotency k WHERE k.submission_id = s.id) AS first_cancel_response_at
FROM submissions s
LEFT JOIN execution_jobs j ON j.submission_id = s.id
WHERE s.match_id = :'match_id'::uuid
ORDER BY s.admitted_at;

SELECT s.id AS submission, j.language, a.attempt_id, a.claimed_at,
       round(1000 * extract(epoch FROM a.claimed_at - s.admitted_at))::int AS claim_ms,
       round(1000 * extract(epoch FROM s.updated_at - a.claimed_at))::int AS after_claim_ms,
       r.outcome, i.case_count, i.sample_count, i.submit_cases_are_samples,
       c.next_ordinal AS checkpoint_prefix, c.last_attempt_id = a.attempt_id AS last_checkpoint_writer,
       (SELECT count(*) FROM execution_verified_cases v
        WHERE v.job_id = j.id AND v.attempt_id = a.attempt_id AND v.ordinal < i.case_count) AS verified_cases,
       (SELECT count(*) FROM execution_verified_cases v
        WHERE v.job_id = j.id AND v.attempt_id = a.attempt_id AND v.ordinal >= i.case_count) AS verified_samples,
       (SELECT count(*) FROM execution_verification_challenges v
        WHERE v.job_id = j.id AND v.attempt_id = a.attempt_id) AS challenges
FROM submissions s
JOIN execution_jobs j ON j.submission_id = s.id
JOIN runner_job_inputs i ON i.job_id = j.id
JOIN execution_attempt_inventory a ON a.job_id = j.id
LEFT JOIN workspaces w ON w.id = s.workspace_id
LEFT JOIN execution_completion_receipts r ON r.job_id = j.id AND r.attempt_id = a.attempt_id
LEFT JOIN execution_checkpoints c ON c.job_id = j.id
-- Post-match executions inherit the match through their review workspace.
WHERE s.match_id = :'match_id'::uuid OR w.review_match_id = :'match_id'::uuid
ORDER BY s.admitted_at, a.claimed_at;

-- Result notifications provide persisted timing boundaries without exposing case content.
SELECT s.id AS submission,
       round(1000 * extract(epoch FROM o.occurred_at - s.admitted_at))::int AS event_ms
FROM submissions s
JOIN submission_outbox o ON o.submission_id = s.id
WHERE s.match_id = :'match_id'::uuid
ORDER BY s.admitted_at, o.sequence;

SELECT s.id AS submission, v.status, count(*) AS cases
FROM submissions s
JOIN execution_jobs j ON j.submission_id = s.id
JOIN execution_verified_cases v ON v.job_id = j.id
WHERE s.match_id = :'match_id'::uuid
GROUP BY s.id, v.status
ORDER BY s.id, v.status;

-- The test panel can display timeout text from a case diagnostic as well as a verdict.
WITH match_submissions AS (
  SELECT id FROM submissions WHERE match_id = :'match_id'::uuid
), displayed_cases AS (
  SELECT c.submission_id, c.channel, c.ordinal, c.result_data
  FROM match_submissions s JOIN submission_public_result_cases c ON c.submission_id = s.id
  UNION ALL
  SELECT c.submission_id, 'private', c.ordinal, c.result_data
  FROM match_submissions s JOIN match_private_result_cases c ON c.submission_id = s.id
)
SELECT submission_id, channel, ordinal
FROM displayed_cases
WHERE convert_from(result_data, 'UTF8') ~* '"status"[[:space:]]*:[[:space:]]*"time_limit"|time limit exceeded'
ORDER BY submission_id, channel, ordinal;

-- Review executions use their own workspace and have no submissions.match_id.
SELECT s.id AS submission, s.kind, s.state, s.result->>'verdict' AS verdict,
       s.admitted_at, s.updated_at, j.language,
       lag(s.source_hash) OVER (PARTITION BY s.owner_id, s.workspace_id, s.kind
                                ORDER BY s.admitted_at, s.id) = s.source_hash AS same_as_previous,
       (SELECT jsonb_agg(jsonb_build_object('ordinal', v.ordinal, 'status', v.status)
                         ORDER BY v.ordinal)
        FROM execution_verified_cases v WHERE v.job_id = j.id AND v.status <> 'accepted') AS failures
FROM workspaces w
JOIN submissions s ON s.workspace_id = w.id
LEFT JOIN execution_jobs j ON j.submission_id = s.id
WHERE w.review_match_id = :'match_id'::uuid
ORDER BY s.admitted_at DESC
LIMIT 40;

-- A nearby result may belong to another workspace. Compare hashes without exposing them.
WITH match_submits AS (
  SELECT owner_id, admitted_at, source_hash
  FROM submissions
  WHERE match_id = :'match_id'::uuid AND kind = 'submit'
)
SELECT DISTINCT s.id AS submission, s.kind, s.state, s.result->>'verdict' AS verdict,
       s.admitted_at, s.match_id, s.source_hash = m.source_hash AS same_source
FROM match_submits m
JOIN submissions s ON s.owner_id = m.owner_id
  AND s.admitted_at BETWEEN m.admitted_at - interval '10 minutes' AND m.admitted_at + interval '1 minute'
WHERE s.match_id IS DISTINCT FROM :'match_id'::uuid
ORDER BY s.admitted_at DESC
LIMIT 40;

COMMIT;
