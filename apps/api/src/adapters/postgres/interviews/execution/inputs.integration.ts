/** @file inputs.integration.ts @description Isolated interview manifest admission. @module interviews */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { sourceHash } from "@quorem/execution";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { parseInterviewExecution } from "../../../../modules/interviews/execution/command.ts";
import { postgresInterviewAdmission } from "./repository.ts";
import { saveInterviewFixture } from "./fixture.ts";
import { setActiveRunnerFixture } from "../runner-inputs/active.ts";
import type { LocalPrincipal } from "../../../../modules/identity/model.ts";
const url = process.env.QUOREM_INPUT_ADMISSION_TEST_URL;
if (
  !url ||
  new URL(url).port !== "55570" ||
  new URL(url).pathname !== "/quorem_hono_input_admission_test" ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
)
  throw new Error("Disposable input-admission database required");
const pool = createNodePool({
  connectionString: url,
  max: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  onIdleError: () => {},
});
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
const actor: LocalPrincipal = {
  kind: "local",
  userId: `manifest-candidate-${crypto.randomUUID()}`,
  displayName: "Candidate",
  admin: false,
  emailVerified: true,
  sessionId: "fixture",
  strongUntil: 0,
};
const host = `manifest-host-${crypto.randomUUID()}`,
  room = crypto.randomUUID(),
  epoch = crypto.randomUUID(),
  document = crypto.randomUUID(),
  version = crypto.randomUUID(),
  source = "return 1";
const signature = {
  className: "Solution",
  methodName: "f",
  parameters: [{ name: "x", type: "int" }],
  returnType: "int",
};
const fixture = {
  problem: {
    id: version,
    signature,
    constraints: [],
    limits: {},
    runtimeRevision: "python-3.12-v1",
    examples: [{ args: [1], expected: 2 }],
  },
  hiddenCases: [{ args: [3], expected: 4 }],
  harnessRevision: "quorem-harness-v2",
};
const receipts = prearmReceipts(run, "execution"),
  admit = postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true });
const fence = async () => {
  const receiptId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    shard = 21;
  await receipts.create(receiptId, shard);
  return { receiptId, jobId, shard };
};
const command = async (level = 1) =>
  parseInterviewExecution(
    JSON.stringify({
      kind: "submit",
      level,
      questionEpoch: epoch,
      documentEpoch: document,
      sourceHash: await sourceHash(source),
    }),
    "test",
  );
let fixtureId: Uint8Array;
before(async () => {
  await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Host'),($2,'Candidate')", [
    host,
    actor.userId,
  ]);
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','fixture','test','test')",
    [crypto.randomUUID(), host],
  );
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Input',$3::jsonb,'python',$4,$5,$6,$7,'x',$8,'y')",
    [
      room,
      host,
      JSON.stringify(fixture),
      source,
      document,
      epoch,
      crypto.randomUUID(),
      crypto.randomUUID(),
    ],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer'),($1,$3,'interviewee')",
    [room, host, actor.userId],
  );
  fixtureId = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      saveInterviewFixture(tx, room, JSON.stringify(fixture)),
    ),
  );
});
after(async () => pool.end());
void test("missing active epoch mapping fails closed before admission", async () => {
  const f = await fence();
  await assert.rejects(
    admit(actor, room, "missing", await command(), f),
    (e: unknown) => e instanceof Error && "status" in e && e.status === 503,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM execution_jobs WHERE id=$1", [f.jobId]))
      .rows[0].n,
    0,
  );
});
void test("interview submit seals private and sample references and fences replay by membership", async () => {
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      setActiveRunnerFixture(tx, room, epoch, fixtureId),
    ),
  );
  const f = await fence(),
    cmd = await command(),
    result = await admit(actor, room, "submit", cmd, f);
  const rows = (
    await pool.query(
      "SELECT i.sealed,i.case_count,i.sample_count,i.private_details,i.submit_cases_are_samples,c.channel,convert_from(b.data,'UTF8') AS raw FROM runner_job_inputs i JOIN runner_job_input_cases c USING(job_id) JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE i.job_id=$1 ORDER BY c.ordinal",
      [f.jobId],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => [
      r.sealed,
      r.case_count,
      r.sample_count,
      r.private_details,
      r.submit_cases_are_samples,
      r.channel,
      JSON.parse(r.raw).expected,
    ]),
    [
      [true, 1, 1, true, false, "private", 4],
      [true, 1, 1, true, false, "sample", 2],
    ],
  );
  await pool.query(
    "UPDATE interviews SET source='edited',document_version=document_version+1 WHERE id=$1",
    [room],
  );
  assert.equal((await admit(actor, room, "submit", cmd, await fence())).id, result.id);
  await assert.rejects(
    admit(actor, room, "new", cmd, await fence()),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "document_changed",
  );
  await pool.query(
    "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id=$2",
    [room, actor.userId],
  );
  await assert.rejects(
    admit(actor, room, "submit", cmd, await fence()),
    (e: unknown) => e instanceof Error && "status" in e && e.status === 404,
  );
});
void test("empty classic private suite uses sample fallback exactly once", async () => {
  const second = crypto.randomUUID(),
    e = crypto.randomUUID(),
    d = crypto.randomUUID(),
    empty = { ...fixture, hiddenCases: [] };
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
    [actor.userId],
  );
  await pool.query(
    "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
    [actor.userId],
  );
  await pool.query("UPDATE submissions SET state='completed' WHERE owner_id=$1", [actor.userId]);
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Fallback',$3::jsonb,'python',$4,$5,$6,$7,'x',$8,'y')",
    [second, host, JSON.stringify(empty), source, d, e, crypto.randomUUID(), crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer'),($1,$3,'interviewee')",
    [second, host, actor.userId],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const id = await saveInterviewFixture(tx, second, JSON.stringify(empty));
      await setActiveRunnerFixture(tx, second, e, id);
    }),
  );
  const cmd = await parseInterviewExecution(
      JSON.stringify({
        kind: "submit",
        level: 1,
        questionEpoch: e,
        documentEpoch: d,
        sourceHash: await sourceHash(source),
      }),
      "fallback",
    ),
    f = await fence();
  await admit(actor, second, "fallback", cmd, f);
  const row = (
    await pool.query(
      "SELECT i.case_count,i.sample_count,i.submit_cases_are_samples,count(c.ordinal)::int AS refs FROM runner_job_inputs i JOIN runner_job_input_cases c USING(job_id) WHERE i.job_id=$1 GROUP BY i.job_id",
      [f.jobId],
    )
  ).rows[0];
  assert.deepEqual(
    [row.case_count, row.sample_count, row.submit_cases_are_samples, row.refs],
    [1, 1, true, 1],
  );
  await pool.query("UPDATE execution_jobs SET finished=true WHERE id=$1", [f.jobId]);
  await pool.query("UPDATE submissions SET state='completed' WHERE owner_id=$1", [actor.userId]);
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
    [actor.userId],
  );
  const makeCustom = async (value: unknown) =>
    parseInterviewExecution(
      JSON.stringify({
        kind: "run",
        level: 1,
        questionEpoch: e,
        documentEpoch: d,
        sourceHash: await sourceHash(source),
        customCases: [{ args: [value], expected: 4 }],
      }),
      "custom",
    );
  await assert.rejects(
    admit(actor, second, "invalid-custom", await makeCustom("bad"), await fence()),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_input",
  );
  const custom = await makeCustom(3),
    cf = await fence();
  await admit(actor, second, "valid-custom", custom, cf);
  const stored = (
    await pool.query(
      "SELECT convert_from(b.data,'UTF8') AS raw FROM runner_job_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.job_id=$1",
      [cf.jobId],
    )
  ).rows[0].raw;
  assert.equal(stored, custom.customCases![0]);
});
void test("interview Odyssey uses only the current manual stage and cumulative cases", async () => {
  await pool.query(
    "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
    [actor.userId],
  );
  await pool.query("UPDATE submissions SET state='completed' WHERE owner_id=$1", [actor.userId]);
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
    [actor.userId],
  );
  const p = (await pool.query("SELECT id::text FROM problem_versions WHERE title='Large' LIMIT 1"))
    .rows[0].id;
  const id = crypto.randomUUID(),
    e = crypto.randomUUID(),
    d = crypto.randomUUID(),
    levels = [
      { methods: [signature], examples: [{ args: [1], expected: 2 }] },
      { methods: [{ ...signature, methodName: "g" }], examples: [{ args: [2], expected: 3 }] },
    ];
  const staged = {
    problem: { ...fixture.problem, id: p, examples: [], odyssey: { levels } },
    hiddenCases: [],
    odysseyHiddenCases: [[{ args: [1], expected: 11 }], [{ args: [2], expected: 22 }]],
    harnessRevision: fixture.harnessRevision,
  };
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,$2,'Stages',$3::jsonb,'python',$4,$5,$6,$7,'x',$8,'y')",
    [id, host, JSON.stringify(staged), source, d, e, crypto.randomUUID(), crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,$2,'interviewer'),($1,$3,'interviewee')",
    [id, host, actor.userId],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const f = await saveInterviewFixture(tx, id, JSON.stringify(staged));
      await setActiveRunnerFixture(tx, id, e, f);
    }),
  );
  const make = async (level: number) =>
    parseInterviewExecution(
      JSON.stringify({
        kind: "submit",
        level,
        questionEpoch: e,
        documentEpoch: d,
        sourceHash: await sourceHash(source),
      }),
      "stage",
    );
  await assert.rejects(
    admit(actor, id, "wrong-stage", await make(2), await fence()),
    (err: unknown) => err instanceof Error && "code" in err && err.code === "stage_changed",
  );
  await pool.query(
    "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,2) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=2",
    [e, p],
  );
  const f = await fence();
  await admit(actor, id, "stage-2", await make(2), f);
  const rows = (
    await pool.query(
      "SELECT c.channel,convert_from(b.data,'UTF8') AS raw FROM runner_job_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.job_id=$1 ORDER BY c.ordinal",
      [f.jobId],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.channel),
    ["private", "private", "sample", "sample"],
  );
  assert.deepEqual(
    rows.map((r) => JSON.parse(r.raw).expected),
    [11, 22, 2, 3],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT level FROM odyssey_progress WHERE scope_id=$1 AND problem_version_id=$2",
        [e, p],
      )
    ).rows[0].level,
    2,
  );
});
