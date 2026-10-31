/** @file integration.ts @description PostgreSQL match reconciliation conformance. @module matches */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { reconcileMatch, reconcileScheduledMatch } from "./repository.ts";
const url = process.env.QUOREM_MATCH_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).port !== "55461" ||
  new URL(url).pathname !== "/quorem_hono_match_test" ||
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
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'T','easy','','{}','[]','{}','test')",
    [version, problem],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','runtime','harness','')",
    [version],
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
void test("ordered pending work fences first correct, then completion updates progress and preserves guest reservation", async () => {
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
  await call(r.id);
  let m = (await pool.query("SELECT state,finalizing_at,outcome FROM matches WHERE id=$1", [r.id]))
    .rows[0];
  assert.equal(m.state, "finalizing");
  assert.equal(m.outcome, null);
  await pool.query(
    "UPDATE submissions SET state='completed',result='{" +
      '"verdict":"wrong_answer","score":{"passed":1,"total":2}}' +
      "'::jsonb WHERE id=$1",
    [first],
  );
  await call(r.id);
  m = (await pool.query("SELECT state,outcome,version FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(m.state, "completed");
  assert.equal(m.outcome.reason, "first_correct");
  assert.equal(
    m.outcome.winnerUserId,
    (await pool.query("SELECT participant_id::text FROM users WHERE id=$1", [r.a])).rows[0]
      .participant_id,
  );
  assert.equal(m.version, "2");
  const usage = (
    await pool.query(
      "SELECT settled_at,charged_seconds FROM guest_execution_usage WHERE submission_id=$1",
      [first],
    )
  ).rows[0];
  assert.equal(usage.settled_at, null);
  assert.equal(usage.charged_seconds, null);
  assert.equal(
    (
      await pool.query(
        "SELECT expires_at<=clock_timestamp()+interval '2 hours' AS shortened FROM guest_sessions WHERE owner_id=$1",
        [r.b],
      )
    ).rows[0].shortened,
    true,
  );
  await Promise.all([call(r.id), call(r.id)]);
  assert.equal(
    (await pool.query("SELECT 1 FROM match_outbox WHERE match_id=$1", [r.id])).rowCount,
    2,
  );
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
void test("checkpoint certainty unblocks an earlier opponent without exposing checkpoint data", async () => {
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
  const match = (await pool.query("SELECT state,outcome FROM matches WHERE id=$1", [r.id])).rows[0];
  assert.equal(match.state, "completed");
  assert.equal(match.outcome.reason, "first_correct");
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
