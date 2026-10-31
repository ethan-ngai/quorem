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
import { postgresExecutionCommands } from "../../judging/worker/repository.ts";
import { localVerifier } from "../../judging/worker/manifest-fixture.ts";
import { dockerSandbox } from "../../../../../../runner/src/sandbox/docker.ts";
import { executeAndStage } from "../../../../../../runner/src/engine/execute.ts";
import { finishAfterTeardown } from "../../../../../../runner/src/queue/finish.ts";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLimits } from "@quorem/execution";
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { workspaceRepository } from "../../workspace/repository.ts";
import { persistQuestionVersion } from "../../problems/publication.ts";
import { languageRuntime } from "@quorem/execution";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
const url = process.env.QUOREM_MATCH_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable match database required");
assertRunnerFixture(url, ["/quorem_hono_match_manifest_test"]);
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
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'T','easy','',$3::jsonb,'[]',$4::jsonb,'test')",
    [
      version,
      problem,
      JSON.stringify({
        className: "Solution",
        methodName: "f",
        parameters: [{ name: "x", type: "int" }],
        returnType: "int",
      }),
      JSON.stringify(defaultLimits()),
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
            limits: defaultLimits(),
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
async function room(active = true, selectedVersion = version) {
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
    [id, a, ...(active ? [selectedVersion] : [])],
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
      [wa, wb, a, b, selectedVersion, id],
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
for (const [verdict, source] of [
  ["accepted", "class Solution:\n def f(self,x): return x+1"],
  ["wrong_answer", "class Solution:\n def f(self,x): return 9"],
  ["syntax_error", "class Solution:\n def f(: pass"],
  ["runtime_error", "class Solution:\n def f(self,x): raise ValueError()"],
  ["time_limit", "class Solution:\n def f(self,x):\n  while True: pass"],
] as const)
  void test(`admitted match submit reaches verified ${verdict}`, async () => {
    const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
    if (!socket) throw new Error("Disposable Docker socket required for verified match regression");
    const r = await room(),
      key = crypto.randomUUID();
    const fence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
    await prearmReceipts(run, "execution").create(fence.receiptId, 0);
    const command = await parseWorkspaceCommand(
      JSON.stringify({
        workspaceId: r.wa,
        kind: "submit",
        source,
      }),
      key,
    );
    const admission = await postgresWorkspaceAdmission(run, {
      losslessCases: true,
      guestExecution: true,
    })(
      {
        kind: "local",
        userId: r.a,
        displayName: "A",
        admin: false,
        emailVerified: true,
        sessionId: "fixture",
        strongUntil: 0,
      },
      key,
      command,
      fence,
    );
    const verifier = await localVerifier(run);
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-match-verified-")));
    try {
      const port = postgresExecutionCommands(
        run,
        {
          inputProtocol: "manifest-v1",
          resumable: true,
          losslessCases: true,
          losslessResults: true,
        },
        verifier.verification,
      );
      const sandbox = await dockerSandbox({
        socket,
        stateRoot,
        namespace: "match-verified",
        cleanupMs: 10000,
      });
      const job = await port.claimAfterTeardown(true, sandbox.scope, null);
      assert.equal(job?.jobId, fence.jobId);
      await executeAndStage(job!, port, sandbox);
      await finishAfterTeardown(port, sandbox, job!);
      const submission = (
        await pool.query("SELECT state,result FROM submissions WHERE id=$1", [admission.id])
      ).rows[0];
      assert.equal(submission.state, "completed");
      assert.equal(submission.result.verdict, verdict);
      const match = (await pool.query("SELECT state,outcome FROM matches WHERE id=$1", [r.id]))
        .rows[0];
      if (verdict === "accepted") {
        assert.equal(match.state, "completed");
        assert.equal(match.outcome.reason, "first_correct");
        assert.equal(
          match.outcome.winnerUserId,
          (await pool.query("SELECT participant_id::text FROM users WHERE id=$1", [r.a])).rows[0]
            .participant_id,
        );
      } else {
        assert.equal(match.outcome, null);
        await pool.query(
          "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1",
          [r.id],
        );
        await call(r.id);
        const final = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
        assert.equal(final.outcome.kind, "draw");
      }
    } finally {
      await verifier.close();
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
void test("verified early failure permits guest winner and late completion cannot overturn it", async () => {
  const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
  if (!socket) throw new Error("Disposable Docker socket required");
  const r = await room(),
    verifier = await localVerifier(run);
  const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-match-race-")));
  try {
    const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true });
    const start = async (guest: boolean) => {
      const key = crypto.randomUUID(),
        fence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
      await prearmReceipts(run, "execution").create(fence.receiptId, 0);
      const command = await parseWorkspaceCommand(
        JSON.stringify({
          workspaceId: guest ? r.wb : r.wa,
          kind: "submit",
          source: guest
            ? "class Solution:\n def f(self,x): return x+1"
            : "class Solution:\n def f(self,x): return 9",
        }),
        key,
      );
      const principal: Principal = guest
        ? {
            kind: "guest" as const,
            userId: r.b,
            displayName: "B",
            admin: false,
            emailVerified: false,
            sessionId: `token-${r.id}`,
            strongUntil: 0,
            credentialExpiresAt: 9999999999,
            scope: { kind: "match" as const, matchId: r.id },
          }
        : {
            kind: "local" as const,
            userId: r.a,
            displayName: "A",
            admin: false,
            emailVerified: true,
            sessionId: "fixture",
            strongUntil: 0,
          };
      const result = await admit(principal, key, command, fence);
      return { fence, result };
    };
    const first = await start(false),
      second = await start(true);
    const port = postgresExecutionCommands(
      run,
      { inputProtocol: "manifest-v1", resumable: true, losslessCases: true, losslessResults: true },
      verifier.verification,
    );
    const sandboxA = await dockerSandbox({
      socket,
      stateRoot,
      namespace: "match-first",
      cleanupMs: 10000,
    });
    const sandboxB = await dockerSandbox({
      socket,
      stateRoot,
      namespace: "match-second",
      cleanupMs: 10000,
    });
    const jobA = await port.claimAfterTeardown(true, sandboxA.scope, null);
    assert.equal(jobA?.jobId, first.fence.jobId);
    let release!: () => void,
      reached!: () => void,
      calls = 0;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const secondCase = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const suspended = {
      ...sandboxA,
      runCase: async (...args: Parameters<typeof sandboxA.runCase>) => {
        if (++calls === 2) {
          reached();
          await pause;
        }
        return sandboxA.runCase(...args);
      },
    };
    const pending = executeAndStage(jobA!, port, suspended);
    await secondCase;
    const verified = (
      await pool.query(
        "SELECT status FROM execution_verified_cases WHERE job_id=$1 ORDER BY ordinal",
        [jobA!.jobId],
      )
    ).rows;
    assert.equal(verified[0].status, "wrong_answer");
    const jobB = await port.claimAfterTeardown(true, sandboxB.scope, null);
    assert.equal(jobB?.jobId, second.fence.jobId);
    await executeAndStage(jobB!, port, sandboxB);
    await finishAfterTeardown(port, sandboxB, jobB!);
    let match = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
    assert.equal(match.outcome.reason, "first_correct");
    const winner = (await pool.query("SELECT participant_id::text FROM users WHERE id=$1", [r.b]))
      .rows[0].participant_id;
    assert.equal(match.outcome.winnerUserId, winner);
    const usage = (
      await pool.query(
        "SELECT settled_at,charged_seconds FROM guest_execution_usage WHERE submission_id=$1",
        [second.result.id],
      )
    ).rows[0];
    assert.ok(usage.settled_at);
    assert.ok(usage.charged_seconds >= 0);
    release();
    await pending;
    await finishAfterTeardown(port, sandboxA, jobA!);
    match = (await pool.query("SELECT outcome FROM matches WHERE id=$1", [r.id])).rows[0];
    assert.equal(match.outcome.winnerUserId, winner);
  } finally {
    await verifier.close();
    await rm(stateRoot, { recursive: true, force: true });
  }
});
void test("verified intermediate match result appears in workspace Odyssey feedback", async () => {
  const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
  if (!socket) throw new Error("Disposable Docker socket required");
  const problemId = crypto.randomUUID(),
    stageVersion = crypto.randomUUID();
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
      "utf8",
    ),
  );
  fixture.problem.id = stageVersion;
  fixture.problem.slug = `stage-${problemId.slice(0, 8)}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO problems(id,slug) VALUES(${problemId}::uuid,${fixture.problem.slug})`,
      );
      await persistQuestionVersion(
        tx,
        JSON.stringify(fixture),
        problemId,
        stageVersion,
        1,
        null,
        (language) => {
          const value = languageRuntime(language);
          return value ? { revision: value.revision, harness: value.harness } : undefined;
        },
      );
    }),
  );
  const r = await room(true, stageVersion),
    key = crypto.randomUUID(),
    fence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
  await prearmReceipts(run, "execution").create(fence.receiptId, 0);
  const principal: Principal = {
    kind: "local",
    userId: r.a,
    displayName: "A",
    admin: false,
    emailVerified: true,
    sessionId: "fixture",
    strongUntil: 0,
  };
  const command = await parseWorkspaceCommand(
    JSON.stringify({
      workspaceId: r.wa,
      kind: "submit",
      level: 1,
      source:
        "class Solution:\n def __init__(self): self.balance=0\n def deposit(self,amount):\n  self.balance+=amount\n  return self.balance",
    }),
    key,
  );
  const admission = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(principal, key, command, fence);
  const verifier = await localVerifier(run),
    stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-match-feedback-")));
  try {
    const port = postgresExecutionCommands(
      run,
      { inputProtocol: "manifest-v1", resumable: true, losslessCases: true, losslessResults: true },
      verifier.verification,
    );
    const sandbox = await dockerSandbox({
      socket,
      stateRoot,
      namespace: "match-feedback",
      cleanupMs: 10000,
    });
    const job = await port.claimAfterTeardown(true, sandbox.scope, null);
    assert.equal(job?.jobId, fence.jobId);
    await executeAndStage(job!, port, sandbox);
    await finishAfterTeardown(port, sandbox, job!);
    const result = (
      await pool.query("SELECT state,result FROM submissions WHERE id=$1", [admission.id])
    ).rows[0];
    assert.equal(result.state, "completed");
    assert.equal(result.result.verdict, "accepted");
    const feedback = JSON.parse(
      await new Response(await workspaceRepository(run).odyssey(principal, r.wa)).text(),
    );
    assert.deepEqual(feedback.caseStatuses, [{ index: 0, status: "accepted" }]);
    const nextKey = crypto.randomUUID(),
      nextFence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
    await prearmReceipts(run, "execution").create(nextFence.receiptId, 0);
    const nextCommand = await parseWorkspaceCommand(
      JSON.stringify({
        workspaceId: r.wa,
        kind: "run",
        level: feedback.level,
        source: "class Solution: pass",
      }),
      nextKey,
    );
    await postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true })(
      principal,
      nextKey,
      nextCommand,
      nextFence,
    );
    const pendingFeedback = JSON.parse(
      await new Response(await workspaceRepository(run).odyssey(principal, r.wa)).text(),
    );
    assert.deepEqual(pendingFeedback.caseStatuses, [{ index: 0, status: "accepted" }]);
  } finally {
    await verifier.close();
    await rm(stateRoot, { recursive: true, force: true });
  }
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
