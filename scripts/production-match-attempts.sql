BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT s.id AS submission, j.language, a.attempt_id, a.claimed_at,
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

COMMIT;
