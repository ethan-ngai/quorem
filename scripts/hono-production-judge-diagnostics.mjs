/** Read-only production judging diagnostics; never print credentials, identities or payloads. */
export async function diagnoseProductionJudge(database, keys, namespace, controls) {
  const { rows: jobs } = await database.query(`SELECT s.state,j.finished,j.attempts,
    j.attempt_id IS NOT NULL AS claimed,j.lease_until>clock_timestamp() AS live,
    i.case_count AS cases,count(*)::int AS count,
    round(max(extract(epoch FROM clock_timestamp()-s.admitted_at)))::int AS age_seconds
    FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id
    JOIN runner_job_inputs i ON i.job_id=j.id
    WHERE s.admitted_at>clock_timestamp()-interval '30 minutes'
    GROUP BY s.state,j.finished,j.attempts,claimed,live,i.case_count ORDER BY age_seconds DESC LIMIT 20`);
  const { rows: databaseState } = await database.query(
    `SELECT
    EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='072_sealed_suite_digests.sql') AS migrated,
    has_table_privilege($1,'public.runner_job_input_digests','SELECT,INSERT,UPDATE,DELETE') AS digest_access,
    (SELECT count(*)::int FROM runner_job_inputs i WHERE i.sealed AND NOT EXISTS
      (SELECT 1 FROM runner_job_input_digests d WHERE d.job_id=i.job_id)) AS missing_digests`,
    [keys.RUNTIME_ROLE],
  );
  const response = await fetch("https://api-hono.quorem.app/internal/runner/state", {
    method: "POST",
    headers: {
      authorization: `Bearer ${keys.QUOREM_RUNNER_COMMAND_SECRET}`,
      "content-type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  return {
    release: controls.runner.release,
    generation: controls.runner.generation,
    active: controls.runner.status === "active" && !controls.cases.paused,
    database: databaseState[0],
    jobs,
    command: { status: response.status, queued: body?.queued, running: body?.running },
    namespacePinned: /^[a-f0-9]{64}$/.test(namespace.namespace),
  };
}
