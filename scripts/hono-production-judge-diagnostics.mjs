/** Inspect production judging and retry its normal fenced drain; never print private payloads. */
import { randomUUID, createHash } from "node:crypto";
import {
  acceptedSource,
  version,
} from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
async function productionRunnerProfile(keys) {
  const response = await fetch("https://runner-hono.quorem.app/internal/profile", {
    method: "POST",
    headers: { authorization: `Bearer ${keys.QUOREM_RUNNER_DRAIN_SECRET}` },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (response.ok) return response.json();
  await response.body?.cancel();
  return null;
}

export async function diagnoseProductionJudge(database, keys, namespace, controls) {
  const profile = await productionRunnerProfile(keys);
  const { rows: jobs } = await database.query(`SELECT s.state,j.finished,j.attempts,
    j.attempt_id IS NOT NULL AS claimed,j.lease_until>clock_timestamp() AS live,
    i.case_count AS cases,count(*)::int AS count,
    round(max(extract(epoch FROM clock_timestamp()-s.admitted_at)))::int AS age_seconds
    FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id
    JOIN runner_job_inputs i ON i.job_id=j.id
    WHERE s.admitted_at>clock_timestamp()-interval '30 minutes'
    GROUP BY s.state,j.finished,j.attempts,claimed,live,i.case_count ORDER BY age_seconds DESC LIMIT 20`);
  const { rows: benchmarkJobs } = await database.query(
    `SELECT s.state,j.finished,j.attempts,i.case_count,
      round(1000*extract(epoch FROM a.claimed_at-s.admitted_at))::int AS claim_ms,
      round(1000*extract(epoch FROM s.updated_at-s.admitted_at))::int AS observed_ms,
      (SELECT count(*)::int FROM execution_checkpoint_cases c WHERE c.job_id=j.id) AS checkpoints,
      (SELECT count(*)::int FROM execution_verified_cases v WHERE v.job_id=j.id) AS verified,
      j.lease_until>clock_timestamp() AS live
      FROM submissions s JOIN workspaces w ON w.id=s.workspace_id
      JOIN execution_jobs j ON j.submission_id=s.id JOIN runner_job_inputs i ON i.job_id=j.id
      LEFT JOIN LATERAL (SELECT min(claimed_at) AS claimed_at FROM execution_attempt_inventory WHERE job_id=j.id) a ON true
      WHERE s.admitted_at>clock_timestamp()-interval '30 minutes' AND s.source_hash=$1 AND w.problem_version_id=$2::uuid
      ORDER BY s.admitted_at DESC LIMIT 24`,
    [createHash("sha256").update(acceptedSource).digest("hex"), version],
  );
  const { rows: authKeyRate } = await database.query(
    `SELECT used,expires_at>clock_timestamp() AS active FROM quorem_auth.rate_limit WHERE bucket=$1`,
    [
      createHash("sha256")
        .update(JSON.stringify(["better-auth", "no-trusted-ip|/jwks"]))
        .digest("hex"),
    ],
  );
  const { rows: databaseState } = await database.query(
    `SELECT
    EXISTS(SELECT 1 FROM public.schema_migrations WHERE name IN ('072_sealed_suite_digests.sql', '083_baseline.sql')) AS migrated,
    has_table_privilege($1,'public.runner_job_input_digests','SELECT,INSERT,UPDATE,DELETE') AS digest_access,
    (SELECT count(*)::int FROM runner_job_inputs i WHERE i.sealed AND NOT EXISTS
      (SELECT 1 FROM runner_job_input_digests d WHERE d.job_id=i.job_id)) AS missing_digests`,
    [keys.RUNTIME_ROLE],
  );
  const { rows: completed } = await database.query(
    `SELECT j.attempt_id,j.sandbox_scope FROM submissions s
      JOIN workspaces w ON w.id=s.workspace_id JOIN execution_jobs j ON j.submission_id=s.id
      WHERE j.finished AND j.attempt_id IS NOT NULL AND s.admitted_at>clock_timestamp()-interval '15 minutes'
      AND s.source_hash=$1 AND w.problem_version_id=$2::uuid ORDER BY s.admitted_at DESC LIMIT 8`,
    [createHash("sha256").update(acceptedSource).digest("hex"), version],
  );
  const nativeTimings = [];
  for (const job of completed) {
    if (job.sandbox_scope !== namespace.scope) continue;
    const response = await fetch(`https://case-hono.quorem.app/internal/case/${job.attempt_id}`, {
      headers: {
        authorization: `Bearer ${keys.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-scope": job.sandbox_scope,
        "x-quorem-owner-nonce": randomUUID(),
        "x-quorem-case-probe": "diagnostics",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    const value = await response.json().catch(() => null);
    if (response.ok && value?.timing) nativeTimings.push(value.timing);
  }
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
    profile,
    nativeTimings,
    release: controls.runner.release,
    generation: controls.runner.generation,
    active: controls.runner.status === "active" && !controls.cases.paused,
    database: databaseState[0],
    authKeyRate: authKeyRate[0] ?? null,
    sandbox,
    drain,
    jobs,
    benchmarkJobs,
    command: { status: response.status, queued: body?.queued, running: body?.running },
    namespacePinned: /^[a-f0-9]{64}$/.test(namespace.namespace),
  };
}

/** Read sandbox phase metadata for reclaimed attempts using the current namespace. */
export async function probeMatchSandboxes(database, keys, namespace, matchId) {
  if (!/^[a-f0-9-]{36}$/i.test(matchId)) throw new Error("Invalid match identifier");
  const { rows } = await database.query(
    `SELECT a.attempt_id, a.claimed_at FROM execution_attempt_inventory a
     JOIN execution_jobs j ON j.id=a.job_id JOIN submissions s ON s.id=j.submission_id
     WHERE s.match_id=$1::uuid AND a.sandbox_scope=$2 AND j.attempt_id<>a.attempt_id
       AND NOT EXISTS (SELECT 1 FROM execution_completion_receipts r
         WHERE r.job_id=j.id AND r.attempt_id=a.attempt_id)
     ORDER BY a.claimed_at LIMIT 20`,
    [matchId, namespace.scope],
  );
  const diagnostics = [];
  for (const { attempt_id, claimed_at } of rows) {
    const response = await fetch(`https://case-hono.quorem.app/internal/case/${attempt_id}`, {
      headers: {
        authorization: `Bearer ${keys.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-scope": namespace.scope,
        "x-quorem-owner-nonce": randomUUID(),
        "x-quorem-case-probe": "diagnostics",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const value = await response.json().catch(() => null);
    const field = (name) => (/^[a-z-]{1,40}$/.test(value?.[name] ?? "") ? value[name] : undefined);
    diagnostics.push({
      attemptId: attempt_id,
      claimedAt: claimed_at,
      status: response.status,
      phase: field("phase"),
      failure: field("failure"),
      source: field("source"),
    });
  }
  return { attempts: diagnostics, runnerProfile: await productionRunnerProfile(keys) };
}
