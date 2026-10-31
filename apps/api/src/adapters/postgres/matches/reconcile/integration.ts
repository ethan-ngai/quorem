/** @file integration.ts @description PostgreSQL match reconciliation conformance. @module matches */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { reconcileMatch, reconcileScheduledMatch } from "./repository.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { postgresWorkspaceAdmission } from "../../judging/admission/repository.ts";
import { indexRunnerFixture } from "../../judging/inputs/fixture.ts";
const url = process.env.QUOREM_MATCH_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).port !== "55572" ||
  new URL(url).pathname !== "/quorem_hono_manifest_reconcile_test" ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
)
  throw new Error("Disposable match database required");
const pool = createNodePool({
  connectionString: url,
  max: 8,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: (e) => {
    throw e;
  },
});
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 8000 }, fn);
const call = (id: string, generation?: string | null) =>
  run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1500 }, (tx) =>
      generation === undefined
        ? reconcileMatch(tx, id)
        : reconcileScheduledMatch(tx, id, generation),
    ),
  );
const problem = crypto.randomUUID(),
  version = crypto.randomUUID();
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,'match-policy')", [problem]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'T','easy','',$3::jsonb,'[]','{}','test')",
    [
      version,
      problem,
      JSON.stringify({
        className: "Solution",
        methodName: "f",
        parameters: [{ name: "x", type: "int" }],
        returnType: "int",
      }),
    ],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
    [version],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      indexRunnerFixture(
        tx,
        { version },
        JSON.stringify({
          problem: {
            signature: {
              className: "Solution",
              methodName: "f",
              parameters: [{ name: "x", type: "int" }],
              returnType: "int",
            },
            constraints: [],
            limits: {},
            examples: [{ args: [1], expected: 2 }],
          },
          hiddenCases: [{ args: [3], expected: 4 }],
        }),
      ),
    ),
  );
});
after(async () => {
  await pool.end();
});
async function room(active = true) {
  const id = crypto.randomUUID(),
    a = `a-${id}`,
    b = `b-${id}`,
    wa = crypto.randomUUID(),
    wb = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES($1,'A','account'),($2,'B','guest')",
    [a, b],
  );
  await pool.query(
    `INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES($1::uuid,$2,$1::uuid::text,clock_timestamp()+interval '1 hour',30,${active ? "'active'" : "'waiting'"},ARRAY['easy'],${active ? "clock_timestamp()" : "NULL"},${active ? "clock_timestamp()+interval '1 hour'" : "NULL"},${active ? "$3" : "NULL"})`,
    [id, a, ...(active ? [version] : [])],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1),($1,$3,2)",
    [id, a, b],
  );
  await pool.query("INSERT INTO match_reservations(owner_id,match_id) VALUES($1,$3),($2,$3)", [
    a,
    b,
    id,
  ]);
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '8 hours')",
    [`token-${id}`, b, id],
  );
  if (active) {
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$3,$5,'python','match',$6),($2,$4,$5,'python','match',$6)",
      [wa, wb, a, b, version, id],
    );
  }
  return { id, a, b, wa, wb };
}
async function submit(
  r: Awaited<ReturnType<typeof room>>,
  owner: string,
  workspace: string,
  sequence: number,
  state: string,
  result: object | null,
) {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases,result,admitted_at) VALUES($1,$2,$3,$4,$5,'submit','','secret-source',$6,'[{},{}]'::jsonb,$7::jsonb,clock_timestamp()+($5::bigint*interval '1 microsecond'))",
    [id, owner, workspace, r.id, sequence, state, result === null ? null : JSON.stringify(result)],
  );
  return id;
}
void test("actual match admission seals its manifest before reconciliation", async () => {
  const r = await room(),
    key = crypto.randomUUID();
  const principal = {
    kind: "local" as const,
    userId: r.a,
    displayName: "A",
    admin: false,
    emailVerified: true,
    sessionId: "fixture",
    strongUntil: 0,
  };
  const fence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
  await prearmReceipts(run, "execution").create(fence.receiptId, fence.shard);
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: r.wa, kind: "submit", source: "x" }),
    key,
  );
  const result = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(principal, key, command, fence);
  const manifest = (
    await pool.query(
      "SELECT sealed,case_count,sample_count FROM runner_job_inputs WHERE job_id=$1",
      [fence.jobId],
    )
  ).rows[0];
  assert.deepEqual(manifest, { sealed: true, case_count: 1, sample_count: 1 });
  assert.equal(result.state, "queued");
  await call(r.id);
  const participant = (
    await pool.query(
      "SELECT submission_state FROM match_participants WHERE match_id=$1 AND owner_id=$2",
      [r.id, r.a],
    )
  ).rows[0];
  assert.equal(participant.submission_state, "queued");
  await pool.query("UPDATE submissions SET state='completed',result=$2::jsonb WHERE id=$1", [
    result.id,
    JSON.stringify({ verdict: "accepted", score: { passed: 1, total: 1 } }),
  ]);
  await call(r.id);
  const match = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(match.outcome, null, "unverified result cannot determine match outcome");
});
void test("expired invitation finishes once, releases reservations and emits safe versioned notice", async () => {
  const r = await room(false);
  await pool.query(
    "UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  await Promise.all([call(r.id), call(r.id)]);
  const match = (await pool.query("SELECT state,outcome,version FROM matches WHERE id=$1", [r.id]))
    .rows[0];
  assert.equal(match.state, "cancelled");
  assert.equal(match.outcome.reason, "invite_expired");
  assert.equal(match.version, "1");
  assert.equal(
    (await pool.query("SELECT 1 FROM match_reservations WHERE match_id=$1", [r.id])).rowCount,
    0,
  );
  const notices = (await pool.query("SELECT * FROM match_outbox WHERE match_id=$1", [r.id])).rows;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].event_type, "match.completed");
  assert.doesNotMatch(JSON.stringify(notices), /token-|secret-source/);
});
void test("unverified ordered results do not award progress or settle guest work", async () => {
  const r = await room();
  const first = await submit(r, r.b, r.wb, 1, "running", null);
  await submit(r, r.a, r.wa, 2, "completed", {
    verdict: "accepted",
    score: { passed: 2, total: 2 },
  });
  await pool.query(
    "INSERT INTO guest_execution_usage(submission_id,match_id,sponsor_id) VALUES($1,$2,$3)",
    [first, r.id, r.a],
  );
  await Promise.all([call(r.id), call(r.id)]);
  const match = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(match.outcome, null);
  const participants = (
    await pool.query("SELECT best_passed FROM match_participants WHERE match_id=$1", [r.id])
  ).rows;
  assert.deepEqual(
    participants.map((p) => p.best_passed),
    [0, 0],
  );
  const usage = (
    await pool.query(
      "SELECT settled_at,charged_seconds FROM guest_execution_usage WHERE submission_id=$1",
      [first],
    )
  ).rows[0];
  assert.equal(usage.settled_at, null);
  assert.equal(usage.charged_seconds, null);
});
void test("deadline is sampled after a contended match lock", async () => {
  const r = await room();
  await pool.query(
    "UPDATE matches SET deadline=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",
    [r.id],
  );
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [r.id]);
    const wait = call(r.id);
    await delay(350);
    await blocker.query("COMMIT");
    await wait;
  } finally {
    blocker.release();
  }
  const row = (await pool.query("SELECT state,outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(row.state, "completed");
  assert.equal(row.outcome.kind, "draw");
  assert.equal(row.outcome.reason, "deadline_score");
});
void test("stale scheduler generations cannot acknowledge newer pending work", async () => {
  const r = await room();
  await pool.query("INSERT INTO match_reconciliation_pending(match_id,generation) VALUES($1,2)", [
    r.id,
  ]);
  await call(r.id, "1");
  assert.equal(
    (
      await pool.query("SELECT generation FROM match_reconciliation_pending WHERE match_id=$1", [
        r.id,
      ])
    ).rows[0].generation,
    "2",
  );
  await call(r.id, "2");
  assert.equal(
    (await pool.query("SELECT 1 FROM match_reconciliation_pending WHERE match_id=$1", [r.id]))
      .rowCount,
    0,
  );
  await call(crypto.randomUUID(), "1");
});
void test("committed admission precedes deadline reconciliation under the match lock", async () => {
  const r = await room(),
    blocker = await pool.connect(),
    id = crypto.randomUUID();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [r.a]);
    await blocker.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [r.id]);
    await blocker.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,match_id,match_sequence,kind,source,source_hash,state,cases) VALUES($1,$2,$3,$4,1,'submit','','hash','running','[]')",
      [id, r.a, r.wa, r.id],
    );
    const scheduled = call(r.id);
    await delay(50);
    await blocker.query("COMMIT");
    await scheduled;
  } finally {
    blocker.release();
  }
  const p = (
    await pool.query(
      "SELECT submission_state FROM match_participants WHERE match_id=$1 AND owner_id=$2",
      [r.id, r.a],
    )
  ).rows[0];
  assert.equal(p.submission_state, "running");
});
void test("legacy checkpoint counters cannot establish manifest certainty", async () => {
  const r = await room();
  const first = await submit(r, r.b, r.wb, 1, "running", null),
    job = crypto.randomUUID();
  await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [job, first]);
  await pool.query(
    "INSERT INTO execution_checkpoints(job_id,next_ordinal,definite_failures) VALUES($1,1,1)",
    [job],
  );
  await submit(r, r.a, r.wa, 2, "completed", {
    verdict: "accepted",
    score: { passed: 2, total: 2 },
  });
  await call(r.id);
  const match = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(match.outcome, null);
  assert.doesNotMatch(
    JSON.stringify((await pool.query("SELECT * FROM match_outbox WHERE match_id=$1", [r.id])).rows),
    /definite_failures|secret-source/,
  );
});
void test("elapsed finalization with unresolved opponent becomes no contest", async () => {
  const r = await room();
  await submit(r, r.b, r.wb, 1, "running", null);
  await submit(r, r.a, r.wa, 2, "completed", {
    verdict: "accepted",
    score: { passed: 2, total: 2 },
  });
  await pool.query(
    "UPDATE matches SET state='finalizing',finalizing_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
    [r.id],
  );
  await call(r.id);
  const match = (await pool.query("SELECT state,outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(match.state, "completed");
  assert.equal(match.outcome.kind, "no_contest");
  assert.equal(match.outcome.reason, "unresolved_eligible_work");
});
