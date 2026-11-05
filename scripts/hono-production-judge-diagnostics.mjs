/** Inspect production judging and retry its normal fenced drain; never print private payloads. */
import { randomUUID } from "node:crypto";
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
  const { rows: attempts } = await database.query(`SELECT j.attempt_id,j.sandbox_scope,
    EXISTS(SELECT 1 FROM execution_completion_staging st WHERE st.job_id=j.id) AS staging,
    (SELECT count(*)::int FROM execution_verified_cases v WHERE v.job_id=j.id) AS verified
    FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id
    WHERE NOT j.finished AND j.attempt_id IS NOT NULL ORDER BY s.admitted_at DESC LIMIT 1`);
  const attempt = attempts[0];
  let sandbox;
  if (attempt) {
    const probe = await fetch(`https://case-hono.quorem.app/internal/case/${attempt.attempt_id}`, {
      headers: {
        authorization: `Bearer ${keys.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-scope": attempt.sandbox_scope,
        "x-quorem-owner-nonce": randomUUID(),
        "x-quorem-case-probe": "diagnostics",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const value = await probe.json().catch(() => null);
    sandbox = {
      status: probe.status,
      scopeMatches: attempt.sandbox_scope === namespace.scope,
      staging: attempt.staging,
      verified: attempt.verified,
      phase: /^[a-z-]{1,40}$/.test(value?.phase ?? "") ? value.phase : undefined,
    };
  }
  // Use the ordinary fenced owner to retry existing work; no manual state rewrites.
  let drain;
  try {
    const probe = await fetch("https://api-hono.quorem.app/internal/runner/drain", {
      method: "POST",
      headers: {
        authorization: `Bearer ${keys.QUOREM_RUNNER_COMMAND_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        origin: "https://case-hono.quorem.app",
        secret: keys.QUOREM_CASE_SECRET,
        namespaceId: namespace.namespace,
        ownerPublicKey: keys.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    const value = await probe.json().catch(() => null);
    drain = {
      status: probe.status,
      queued: value?.queued,
      running: value?.running,
      failureKind: ["teardown", "command", "other"].includes(value?.failure?.kind)
        ? value.failure.kind
        : undefined,
      fingerprint: /^[a-f0-9]{64}$/.test(value?.failure?.fingerprint ?? "")
        ? value.failure.fingerprint
        : undefined,
      teardown: value?.failure?.teardown,
    };
  } catch {
    drain = { transport: "unavailable" };
  }
  return {
    release: controls.runner.release,
    generation: controls.runner.generation,
    active: controls.runner.status === "active" && !controls.cases.paused,
    database: databaseState[0],
    sandbox,
    drain,
    jobs,
    command: { status: response.status, queued: body?.queued, running: body?.running },
    namespacePinned: /^[a-f0-9]{64}$/.test(namespace.namespace),
  };
}
