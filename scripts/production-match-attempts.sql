BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

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
LEFT JOIN execution_completion_receipts r ON r.job_id = j.id AND r.attempt_id = a.attempt_id
LEFT JOIN execution_checkpoints c ON c.job_id = j.id
WHERE s.match_id = :'match_id'::uuid AND s.kind = 'submit'
ORDER BY s.admitted_at, a.claimed_at;

-- Result notifications provide persisted timing boundaries without exposing case content.
SELECT s.id AS submission,
       round(1000 * extract(epoch FROM o.occurred_at - s.admitted_at))::int AS event_ms
FROM submissions s
JOIN submission_outbox o ON o.submission_id = s.id
WHERE s.match_id = :'match_id'::uuid AND s.kind = 'submit'
ORDER BY s.admitted_at, o.sequence;

SELECT s.id AS submission, v.status, count(*) AS cases
FROM submissions s
JOIN execution_jobs j ON j.submission_id = s.id
JOIN execution_verified_cases v ON v.job_id = j.id
WHERE s.match_id = :'match_id'::uuid AND s.kind = 'submit'
GROUP BY s.id, v.status
ORDER BY s.id, v.status;

COMMIT;
