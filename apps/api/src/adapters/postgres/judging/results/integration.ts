/** @file integration.ts @description Isolated result and cancellation conformance. @module judging */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import type { LocalPrincipal, GuestPrincipal } from "../../../../modules/identity/model.ts";
import { submissionSnapshots } from "./repository.ts";
const url = process.env.QUOREM_RESULTS_TEST_DATABASE_URL;
if (
  !url ||
  !["/quorem_hono_results_test", "/quorem_hono_result_stream_test"].includes(
    new URL(url).pathname,
  ) ||
  !["postgres:", "postgresql:"].includes(new URL(url).protocol) ||
  new URL(url).searchParams.has("host") ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname)
)
  throw new Error("Disposable results database required");
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
    withNodeConnection(pool, { lifetimeMs: 8000 }, fn),
  // Backfill locks one legacy result per offline operation, not an HTTP page.
  operatorRun = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 120000 }, fn),
  actual = submissionSnapshots(run),
  repo = {
    ...actual,
    read: async (...args: Parameters<typeof actual.read>) =>
      new Response(await actual.read(...args)).text(),
    interview: async (...args: Parameters<typeof actual.interview>) =>
      new Response(await actual.interview(...args)).text(),
  };
const principal = (userId: string): LocalPrincipal => ({
  kind: "local",
  userId,
  displayName: userId,
  admin: false,
  emailVerified: true,
  sessionId: "local",
  strongUntil: 0,
});
const alice = principal("results-alice"),
  bob = principal("results-bob"),
  host = principal("results-host");
const problem = crypto.randomUUID(),
  version = crypto.randomUUID(),
  workspace = crypto.randomUUID(),
  queued = crypto.randomUUID(),
  running = crypto.randomUUID(),
  done = crypto.randomUUID(),
  interview = crypto.randomUUID(),
  epoch = crypto.randomUUID(),
  document = crypto.randomUUID(),
  interviewSubmission = crypto.randomUUID(),
  match = crypto.randomUUID(),
  matchWorkspace = crypto.randomUUID(),
  guestSubmission = crypto.randomUUID();
const guest: GuestPrincipal = {
  kind: "guest",
  userId: "results-guest",
  displayName: "Guest",
  admin: false,
  emailVerified: false,
  strongUntil: 0,
  credentialExpiresAt: 9999999999,
  sessionId: "guest-token-hash",
  scope: { kind: "match", matchId: match },
};
const result =
  '{"verdict":"wrong_answer","score":{"passed":0,"total":2},"publicCases":[{"index":0,"status":"wrong_answer","actual":[9007199254740993,"A\\u0000B"],"expected":9007199254740995,"attemptId":"LEAK"}],"hiddenCases":[{"index":0,"status":"wrong_answer","expected":"PRIVATE","actual":"SECRET"}],"diagnostics":[{"message":"safe","jobId":"LEAK"}],"jobId":"LEAK"}';
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES ('results-alice','Alice','account'),('results-bob','Bob','account'),('results-host','Host','account'),('results-guest','Guest','guest'),('results-iguest','Interview guest','guest')",
  );
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,'results-problem')", [problem]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Test','easy','','{}','[]','{}','test')",
    [version, problem],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','runtime','harness','')",
    [version],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'results-alice',$2,'python')",
    [workspace, version],
  );
  for (const [id, state] of [
    [queued, "queued"],
    [done, "completed"],
  ] as const) {
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','hash',$3,'[]',CASE WHEN $3='completed' THEN '{\"verdict\":\"wrong_answer\"}'::jsonb ELSE NULL END,CASE WHEN $3='completed' THEN $4::bytea ELSE NULL END)",
      [id, workspace, state, Buffer.from(result)],
    );
    await pool.query("INSERT INTO execution_jobs(id,submission_id,finished) VALUES($1,$2,$3)", [
      crypto.randomUUID(),
      id,
      state === "completed",
    ]);
  }
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES($1,'results-host','results-match',clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])",
    [match],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,'results-guest',1)",
    [match],
  );
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES('guest-token-hash','results-guest',$1,clock_timestamp()+interval '1 hour')",
    [match],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,'results-guest',$2,'python','match',$3)",
    [matchWorkspace, version, match],
  );
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,match_id,kind,source,source_hash,state,cases) VALUES($1,'results-guest',$2,$3,'run','','guest-hash','queued','[]')",
    [guestSubmission, matchWorkspace, match],
  );
  await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
    crypto.randomUUID(),
    guestSubmission,
  ]);
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,'results-host','Interview','{}','python','',$2,$3,'ri','ri','rj','rj')",
    [interview, document, epoch],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,'results-host','interviewer'),($1,'results-alice','interviewee')",
    [interview],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,'results-iguest','interviewee')",
    [interview],
  );
  await pool.query(
    "INSERT INTO interview_guest_sessions(token_hash,owner_id,session_id,expires_at) VALUES('interview-guest-hash','results-iguest',$1,clock_timestamp()+interval '1 hour')",
    [interview],
  );
  const fixture = JSON.stringify({
    problem: { id: version, odyssey: { levels: [{}, {}] } },
    odysseyHiddenCases: [
      [{ args: [1], expected: "PRIVATE-FIRST" }],
      [{ args: [2], expected: "PRIVATE-FUTURE" }],
    ],
  });
  const lossless = Buffer.from(
    `{"problem":{"id":"${version}","odyssey":{"levels":[{},{}]}},"odysseyHiddenCases":[[{"args":[9007199254740993],"expected":"PRIVATE-FIRST\\u0000"}],[{"args":[2],"expected":"PRIVATE-FUTURE"}]]}`,
  );
  const row = await pool.query(
    "WITH f AS (SELECT jsonb_set($2::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256($3::bytea),'hex'))) AS value) INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT $1,sha256(convert_to(value::text,'UTF8')),value,$3 FROM f RETURNING id",
    [interview, fixture, lossless],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'submit','','hash','completed','[]','{\"verdict\":\"wrong_answer\"}',$3)",
      [interviewSubmission, interview, Buffer.from(result)],
    );
    await client.query(
      "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level,private_results,private_results_payload) VALUES($1,$2,1,$3,$4,$5,1,$6::jsonb,$7)",
      [
        interviewSubmission,
        interview,
        document,
        epoch,
        row.rows[0].id,
        JSON.stringify([{ index: 0, status: "wrong_answer" }]),
        Buffer.from(
          '[{"index":0,"status":"wrong_answer","actual":[9007199254740995,"PRIVATE-OUTPUT\\u0000"],"expected":"PRIVATE-FIRST"}]',
        ),
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const { backfillSubmissionResult } = await import("./backfill.ts");
  const { backfillHistoricalRunnerInput } =
    await import("../../interviews/runner-inputs/legacy-backfill.ts");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      backfillHistoricalRunnerInput(tx, interview, row.rows[0].id),
    ),
  );
  for (const id of [done, interviewSubmission])
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillSubmissionResult(tx, id),
      ),
    );
});
after(async () => {
  await pool.end();
});
void test("owner projection preserves NUL and exact numbers with no hidden payload or internal IDs", async () => {
  const raw = await repo.read(alice, done);
  assert.match(raw, /9007199254740993/);
  assert.match(raw, /9007199254740995/);
  assert.match(raw, /A\\u0000B/);
  assert.doesNotMatch(raw, /PRIVATE|SECRET|LEAK|jobId|attemptId/);
  assert.deepEqual(JSON.parse(raw).hiddenCases, [{ index: 0, status: "wrong_answer" }]);
  await assert.rejects(repo.read(bob, done));
});
void test("queued cancellation is monotonic, idempotent, and conflicts on key reuse", async () => {
  const first = await repo.cancel(alice, queued, "operation-one");
  assert.equal(JSON.parse(first).state, "cancelled");
  assert.deepEqual(
    JSON.parse(await repo.cancel(alice, queued, "operation-one")),
    JSON.parse(first),
  );
  await assert.rejects(
    repo.cancel(alice, done, "operation-one"),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "idempotency_conflict",
  );
  assert.deepEqual(
    (
      await pool.query("SELECT finished,attempt_id FROM execution_jobs WHERE submission_id=$1", [
        queued,
      ])
    ).rows[0],
    { finished: true, attempt_id: null },
  );
  await assert.rejects(repo.cancel(alice, done, "terminal"));
});
void test("running cancellation requests remain running until the judge settles", async () => {
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','hash','running','[]')",
    [running, workspace],
  );
  await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
    crypto.randomUUID(),
    running,
  ]);
  const first = await repo.cancel(alice, running, "operation-two");
  assert.equal(JSON.parse(first).state, "running");
  assert.equal(
    (await pool.query("SELECT cancel_requested FROM submissions WHERE id=$1", [running])).rows[0]
      .cancel_requested,
    true,
  );
  await pool.query("UPDATE submissions SET state='cancelled' WHERE id=$1", [running]);
  assert.equal(JSON.parse(await repo.cancel(alice, running, "operation-two")).state, "running");
  assert.equal(JSON.parse(await repo.cancel(alice, running, "new-key")).state, "cancelled");
});
void test("generic and interview reads enforce role, reveal and epoch", async () => {
  const generic = await repo.read(alice, interviewSubmission);
  assert.doesNotMatch(generic, /hiddenCases|diagnostics|PRIVATE/);
  const candidate = await repo.interview(alice, interview, interviewSubmission);
  assert.doesNotMatch(candidate, /PRIVATE|hiddenCases|diagnostics/);
  const interviewer = await repo.interview(host, interview, interviewSubmission);
  assert.match(interviewer, /PRIVATE-FIRST/);
  assert.match(interviewer, /9007199254740993/);
  assert.match(interviewer, /9007199254740995/);
  assert.match(interviewer, /PRIVATE-OUTPUT\\u0000/);
  assert.match(interviewer, /PRIVATE-FIRST\\u0000/);
  assert.doesNotMatch(interviewer, /PRIVATE-FUTURE/);
  await assert.rejects(repo.interview(bob, interview, interviewSubmission));
  await pool.query(
    "INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES($1,$2,'level:1:case:0')",
    [interview, epoch],
  );
  assert.match(await repo.interview(alice, interview, interviewSubmission), /PRIVATE-FIRST/);
  await pool.query("UPDATE interviews SET question_epoch=$2 WHERE id=$1", [
    interview,
    crypto.randomUUID(),
  ]);
  assert.doesNotMatch(await repo.interview(alice, interview, interviewSubmission), /PRIVATE-FIRST/);
});
void test("guest credentials and scope are live on reads and cancellation", async () => {
  assert.equal(JSON.parse(await repo.read(guest, guestSubmission)).state, "queued");
  await pool.query("UPDATE submissions SET kind='submit' WHERE id=$1", [guestSubmission]);
  await assert.rejects(repo.cancel(guest, guestSubmission, "match-submit"));
  await pool.query("UPDATE submissions SET kind='run' WHERE id=$1", [guestSubmission]);
  await assert.rejects(
    repo.read(
      { ...guest, scope: { kind: "match" as const, matchId: crypto.randomUUID() } },
      guestSubmission,
    ),
  );
  await pool.query(
    "UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash='guest-token-hash'",
  );
  await assert.rejects(repo.read(guest, guestSubmission));
  await assert.rejects(repo.cancel(guest, guestSubmission, "guest-key"));
});
void test("real HTTP preserves result privacy, idempotency and shared errors", async () => {
  const { createApp } = await import("../../../../app.ts");
  const { submissionRoutes } = await import("../../../../modules/judging/results/routes.ts");
  const { serve } = await import("@hono/node-server");
  const app = createApp({ allowedOrigins: [], requestId: () => "results-request" }).route(
    "/",
    submissionRoutes({
      snapshots: actual,
      identify: async (request) =>
        request.headers.get("authorization") === "missing" ? undefined : alice,
    }),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  try {
    if (!server.listening) await new Promise<void>((done) => server.once("listening", done));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("listener unavailable");
    const base = `http://127.0.0.1:${addr.port}`;
    const ok: Response = await fetch(`${base}/v1/submissions/${done}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await ok.text(), /PRIVATE|SECRET|LEAK/);
    assert.equal(
      (await fetch(`${base}/v1/submissions/${done}`, { headers: { authorization: "missing" } }))
        .status,
      401,
    );
    assert.equal(
      (await fetch(`${base}/v1/submissions/${done}/cancel`, { method: "POST" })).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/v1/submissions/${done}/cancel`, {
          method: "POST",
          headers: { "Idempotency-Key": "k" },
          body: '{"unexpected":true}',
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
  }
});
void test("completion races with cancellation under the shared judge lock", async () => {
  const id = crypto.randomUUID(),
    job = crypto.randomUUID(),
    attempt = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','hash','running','[]')",
    [id, workspace],
  );
  await pool.query(
    "INSERT INTO execution_jobs(id,submission_id,attempt_id,lease_until) VALUES($1,$2,$3,clock_timestamp()+interval '1 minute')",
    [job, id, attempt],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(740020)");
    const cancel = repo.cancel(alice, id, "race");
    await client.query(
      "UPDATE submissions SET state='completed',result='{\"verdict\":\"accepted\"}' WHERE id=$1",
      [id],
    );
    await client.query("UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE id=$1", [
      job,
    ]);
    await client.query("COMMIT");
    await assert.rejects(
      cancel,
      (e: unknown) => e instanceof Error && "code" in e && e.code === "invalid_transition",
    );
    const stale = await pool.query(
      "SELECT 1 FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running'",
      [job, attempt],
    );
    assert.equal(stale.rowCount, 0);
  } finally {
    client.release();
  }
});

void test("interview guest reads require live membership and correct scope", async () => {
  const actor: GuestPrincipal = {
    kind: "guest",
    userId: "results-iguest",
    displayName: "Guest",
    admin: false,
    emailVerified: false,
    strongUntil: 0,
    credentialExpiresAt: 9999999999,
    sessionId: "interview-guest-hash",
    scope: { kind: "interview", interviewId: interview },
  };
  const value = await repo.interview(actor, interview, interviewSubmission);
  assert.doesNotMatch(value, /PRIVATE|hiddenCases|diagnostics/);
  await pool.query(
    "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id='results-iguest'",
    [interview],
  );
  await assert.rejects(repo.interview(actor, interview, interviewSubmission));
});
void test("a cancellation preceding completion remains authoritative", async () => {
  const id = crypto.randomUUID(),
    job = crypto.randomUUID(),
    attempt = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','hash','running','[]')",
    [id, workspace],
  );
  await pool.query(
    "INSERT INTO execution_jobs(id,submission_id,attempt_id,lease_until) VALUES($1,$2,$3,clock_timestamp()+interval '1 minute')",
    [job, id, attempt],
  );
  await repo.cancel(alice, id, "race-cancel-first");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(740020)");
    const live = await client.query(
      "SELECT s.cancel_requested FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' FOR UPDATE OF j,s",
      [job, attempt],
    );
    assert.equal(live.rows[0].cancel_requested, true);
    await client.query("UPDATE submissions SET state='cancelled' WHERE id=$1", [id]);
    await client.query("UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE id=$1", [
      job,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  assert.equal(JSON.parse(await repo.read(alice, id)).state, "cancelled");
});
void test("database failures become a safe unavailable transport response", async () => {
  const { createApp } = await import("../../../../app.ts");
  const { submissionRoutes } = await import("../../../../modules/judging/results/routes.ts");
  const unavailable = submissionSnapshots(async () => {
    throw new Error("DATABASE SECRET");
  });
  const app = createApp({ allowedOrigins: [], requestId: () => "outage" }).route(
    "/",
    submissionRoutes({ snapshots: unavailable, identify: async () => alice }),
  );
  const response = await app.request(`/v1/submissions/${done}`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /DATABASE SECRET/);
});
void test("concurrent retries produce one persisted cancellation response", async () => {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','hash','queued','[]')",
    [id, workspace],
  );
  await pool.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
    crypto.randomUUID(),
    id,
  ]);
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => repo.cancel(alice, id, "parallel-key")),
  );
  assert.equal(new Set(responses.map((v) => JSON.stringify(JSON.parse(v)))).size, 1);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM cancellation_idempotency WHERE owner_id='results-alice' AND key='parallel-key'",
        )
      ).rows[0].count,
    ),
    1,
  );
});

void test("private stream stops on revocation and cancellation releases the connection", async () => {
  const stream = await actual.interview(host, interview, interviewSubmission);
  const reader = stream.getReader();
  for (let i = 0; i < 5; i++) await reader.read();
  await pool.query(
    "UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=$1 AND user_id='results-host'",
    [interview],
  );
  try {
    await assert.rejects(async () => {
      while (!(await reader.read()).done) {}
    });
  } finally {
    await pool.query(
      "UPDATE interview_members SET removed_at=NULL WHERE session_id=$1 AND user_id='results-host'",
      [interview],
    );
  }
  let transactions = 0;
  const counted: typeof run = async (fn) => {
    transactions++;
    return run(fn);
  };
  const cancelled = (await submissionSnapshots(counted).read(alice, done)).getReader();
  await cancelled.read();
  const before = transactions;
  await cancelled.cancel();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(transactions, before);
  assert.equal(pool.waitingCount, 0);
});

void test("legacy backfill streams split UTF-8 and rejects nonterminal rows", async () => {
  const { backfillSubmissionResult } = await import("./backfill.ts");
  const id = crypto.randomUUID();
  const text = "x".repeat(65525) + "🐈\u0000";
  const payload = JSON.stringify({
    verdict: "accepted",
    publicCases: [{ index: 0, status: "passed", actual: text }],
    hiddenCases: [{ index: 0, status: "passed", expected: "secret" }],
  });
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','hash','running','[]','{}',$3)",
    [id, workspace, Buffer.from(payload)],
  );
  const backfill = () =>
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillSubmissionResult(tx, id),
      ),
    );
  assert.equal(await backfill(), false);
  await pool.query("UPDATE submissions SET state='completed' WHERE id=$1", [id]);
  assert.equal(await backfill(), true);
  assert.equal(await backfill(), true);
  const output = await repo.read(alice, id);
  assert.match(output, /🐈\\u0000/);
  assert.doesNotMatch(output, /secret/);
});
void test("retention invalidates an in-flight result watermark", async () => {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) SELECT $1,owner_id,workspace_id,kind,source,source_hash,'completed',cases,result,result_payload FROM submissions WHERE id=$2",
    [id, done],
  );
  const { backfillSubmissionResult } = await import("./backfill.ts");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      backfillSubmissionResult(tx, id),
    ),
  );
  const reader = (await actual.read(alice, id)).getReader();
  await reader.read();
  await pool.query("UPDATE submissions SET result=NULL WHERE id=$1", [id]);
  await assert.rejects(async () => {
    while (!(await reader.read()).done) {}
  }, /changed/);
});
void test("a database outage terminates a started stream", async () => {
  let fail = false;
  const flaky: typeof run = (fn) =>
    fail ? Promise.reject(new Error("database offline")) : run(fn);
  const reader = (await submissionSnapshots(flaky).read(alice, done)).getReader();
  await reader.read();
  fail = true;
  await assert.rejects(async () => {
    while (!(await reader.read()).done) {}
  }, /database offline/);
});
void test("normalizes large legacy case and diagnostic fields through bounded source ranges", async () => {
  const { backfillSubmissionResult } = await import("./backfill.ts");
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','large-legacy','completed','[]','{}',convert_to('{"publicCases":[{"index":0,"status":"passed","actual":"'||repeat('x',16777216)||'","diagnostics":[{"message":"hi\\u0000","line":2,"ignored":"PRIVATE"}]}],"diagnostics":[{"message":"'||repeat('y',16777216)||'"}]}','UTF8'))`,
    [id, workspace],
  );
  await assert.rejects(
    withNodeConnection(pool, { lifetimeMs: 20 }, (scope) =>
      scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
        backfillSubmissionResult(tx, id),
      ),
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM submission_result_headers WHERE submission_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
  await operatorRun(async (scope) => {
    await scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, async (tx) => {
      await backfillSubmissionResult(tx, id);
      const spool = (
        await tx.execute<{ uncompressed: boolean; size: number }>(
          sql`SELECT pg_column_compression(raw) IS NULL AS uncompressed, pg_column_size(raw) AS size FROM quorem_legacy_source WHERE id=${id}::uuid AND kind='public'`,
        )
      ).rows[0];
      assert.equal(spool.uncompressed, true);
      assert.ok(spool.size > 32 * 1024 * 1024);
    });
    await scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, async (tx) => {
      assert.equal(
        (
          await tx.execute<{ dropped: boolean }>(
            sql`SELECT to_regclass('pg_temp.quorem_legacy_source') IS NULL AS dropped`,
          )
        ).rows[0].dropped,
        true,
      );
    });
  });
  const reader = (await actual.read(alice, id)).getReader();
  let total = 0,
    max = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    max = Math.max(max, part.value.byteLength);
  }
  assert.ok(total > 32 * 1024 * 1024);
  assert.ok(max <= 65536);
});
void test("legacy case validation rolls back malformed and duplicate fields", async () => {
  const { backfillSubmissionResult } = await import("./backfill.ts");
  for (const payload of [
    '{"publicCases":[{"index":0,"status":"passed","status":"failed"}]}',
    '{"publicCases":[{"index":0,"status":"passed","sqlTypes":[42]}]}',
    '{"publicCases":[{"index":0,"status":"passed","diagnostics":[{"message":1}]}]}',
  ]) {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','bad','completed','[]','{}',$3)",
      [id, workspace, Buffer.from(payload)],
    );
    await assert.rejects(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
          backfillSubmissionResult(tx, id),
        ),
      ),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM submission_public_result_cases WHERE submission_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
  }
});
void test("empty header arrays survive normalization and missing fields fail before streaming", async () => {
  const { backfillSubmissionResult } = await import("./backfill.ts");
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','empty','completed','[]','{}',$3)",
    [
      id,
      workspace,
      Buffer.from('{"verdict":"accepted","publicCases":[],"hiddenCases":[],"diagnostics":[]}'),
    ],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      backfillSubmissionResult(tx, id),
    ),
  );
  const parsed = JSON.parse(await repo.read(alice, id));
  assert.deepEqual(parsed.publicCases, []);
  assert.deepEqual(parsed.hiddenCases, []);
  assert.deepEqual(parsed.diagnostics, []);
  const bad = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','bad-header','running','[]')",
    [bad, workspace],
  );
  await pool.query(
    "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,$2)",
    [
      bad,
      Buffer.from(
        '{"publicCasesPresent":false,"publicCaseCount":0,"channel":"public","diagnosticsPresent":true}',
      ),
    ],
  );
  await pool.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [bad]);
  await assert.rejects(actual.read(alice, bad), /Incomplete result header field/);
});
void test("legacy variable header strings stay bounded without an invented limit", async () => {
  const { backfillSubmissionResult } = await import("./backfill.ts");
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'results-alice',$2,'run','','large-header','completed','[]','{}',convert_to('{"verdict":"'||repeat('v',16777216)||'","hiddenCases":[{"index":0,"status":"'||repeat('s',16777216)||'"}]}','UTF8'))`,
    [id, workspace],
  );
  await operatorRun((scope) =>
    scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
      backfillSubmissionResult(tx, id),
    ),
  );
  const reader = (await actual.read(alice, id)).getReader();
  let total = 0,
    max = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    max = Math.max(max, part.value.byteLength);
  }
  assert.ok(total > 32 * 1024 * 1024);
  assert.ok(max <= 65536);
});
async function legacyPrivateFixture(
  payload: string,
  initial: string[],
  authoritative = false,
): Promise<string> {
  const id = crypto.randomUUID(),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases,result) VALUES($1,'results-alice',$2,'submit','','legacy-private','running','[]','{}')",
      [id, interview],
    );
    await client.query(
      "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level,private_results,private_results_payload) SELECT $1,session_id,document_version,document_epoch,question_epoch,fixture_id,level,$3::jsonb,$4 FROM interview_execution WHERE submission_id=$2",
      [
        id,
        interviewSubmission,
        JSON.stringify(initial.map((_, index) => ({ index, status: "passed" }))),
        Buffer.from(payload),
      ],
    );
    for (let i = 0; i < initial.length; i++)
      await client.query(
        "INSERT INTO interview_private_result_cases(submission_id,ordinal,result_data) VALUES($1,$2,$3)",
        [id, i, Buffer.from(initial[i])],
      );
    if (authoritative)
      await client.query(
        "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,$2)",
        [id, Buffer.from('{"publicCasesPresent":false,"publicCaseCount":0,"channel":"sample"}')],
      );
    await client.query("UPDATE submissions SET state='completed' WHERE id=$1", [id]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
void test("legacy private sidecars rebuild atomically from the locked source", async () => {
  const { backfillPrivateResultCases } =
    await import("../../interviews/question/private-results.ts");
  const raw = '[{"index":0,"status":"passed","actual":{"z":1,"a":2}}]';
  const previous = '{"actual":{"a":2,"z":1},"index":0,"status":"passed"}';
  const id = await legacyPrivateFixture(raw, [previous]);
  assert.equal(
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillPrivateResultCases(tx, id),
      ),
    ),
    true,
  );
  const data = (
    await pool.query(
      "SELECT convert_from(result_data,'UTF8') AS data FROM interview_private_result_cases WHERE submission_id=$1",
      [id],
    )
  ).rows[0].data;
  assert.match(data, /"z":1,"a":2/);
  const protectedId = await legacyPrivateFixture(raw, [previous], true);
  await assert.rejects(
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillPrivateResultCases(tx, protectedId),
      ),
    ),
    /Conflicting legacy case/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT convert_from(result_data,'UTF8') AS data FROM interview_private_result_cases WHERE submission_id=$1",
        [protectedId],
      )
    ).rows[0].data,
    previous,
  );
});
void test("a failed legacy rebuild rolls back deleted sidecars", async () => {
  const { backfillPrivateResultCases } =
    await import("../../interviews/question/private-results.ts");
  const previous = '{"index":0,"status":"passed","actual":1}';
  const id = await legacyPrivateFixture(
    '[{"index":0,"status":"passed","actual":2},{"index":1,"status":4}]',
    [previous, '{"index":1,"status":"passed"}'],
  );
  await assert.rejects(
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillPrivateResultCases(tx, id),
      ),
    ),
  );
  const rows = await pool.query(
    "SELECT convert_from(result_data,'UTF8') AS data FROM interview_private_result_cases WHERE submission_id=$1 ORDER BY ordinal",
    [id],
  );
  assert.equal(rows.rowCount, 2);
  assert.equal(rows.rows[0].data, previous);
});
void test("legacy repair samples source only after acquiring the execution lock", async () => {
  const { backfillPrivateResultCases } =
    await import("../../interviews/question/private-results.ts");
  const old = '{"index":0,"status":"passed","actual":1}',
    id = await legacyPrivateFixture("[" + old + "]", [old]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE interview_execution SET private_results_payload=$2 WHERE submission_id=$1",
      [id, Buffer.from('[{"index":0,"status":"passed","actual":2}]')],
    );
    const pending = run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        backfillPrivateResultCases(tx, id),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.query("COMMIT");
    assert.equal(await pending, true);
    const data = (
      await pool.query(
        "SELECT convert_from(result_data,'UTF8') AS data FROM interview_private_result_cases WHERE submission_id=$1",
        [id],
      )
    ).rows[0].data;
    assert.match(data, /"actual":2/);
  } finally {
    client.release();
  }
});
void test("actual 27 interview promotion feeds authorized streamed results", async () => {
  const { postgresCompletionStaging } = await import("../worker/staging.ts");
  const { postgresCompletionPromotion } = await import("../worker/promote.ts");
  const { indexRunnerFixture } = await import("../inputs/fixture.ts");
  const { bindJobInputs } = await import("../inputs/bind.ts");
  const { postgresInputReader } = await import("../inputs/read.ts");
  const { postgresVerificationSource } = await import("../worker/verification-source.ts");
  const { nodeResultVerifier } =
    await import("../../../../../../runner/src/verification/verifier.ts");
  const { backfillHistoricalRunnerInput } =
    await import("../../interviews/runner-inputs/legacy-backfill.ts");
  const session = crypto.randomUUID(),
    questionEpoch = crypto.randomUUID(),
    documentEpoch = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    attemptId = crypto.randomUUID();
  const fixture = JSON.stringify({
    problem: {
      id: version,
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      constraints: [],
      limits: {
        wallTimeMs: 2000,
        memoryBytes: 268435456,
        outputBytes: 65536,
        maxProcesses: 16,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      },
      examples: [],
    },
    hiddenCases: [{ args: [], expected: 2 }],
  });
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,'results-host','promotion','{}','python','',$2,$3,$4,$4,$5,$5)",
    [session, documentEpoch, questionEpoch, crypto.randomUUID(), crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,'results-host','interviewer'),($1,'results-alice','interviewee')",
    [session],
  );
  const fixtureId = (
    await pool.query(
      "WITH f AS (SELECT $2::jsonb AS value) INSERT INTO interview_question_snapshots(session_id,id,fixture) SELECT $1,sha256(convert_to(value::text,'UTF8')),value FROM f RETURNING id",
      [session, fixture],
    )
  ).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'submit','','hash','running','[{\"args\":[],\"expected\":2}]')",
      [submission, session],
    );
    await client.query(
      "INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level) VALUES($1,$2,1,$3,$4,$5,1)",
      [submission, session, documentEpoch, questionEpoch, fixtureId],
    );
    await client.query(
      "INSERT INTO execution_jobs(id,submission_id,attempt_id,sandbox_scope,lease_until,attempts) VALUES($1,$2,$3,'promotion-test',clock_timestamp()+interval '1 minute',1)",
      [jobId, submission, attemptId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      backfillHistoricalRunnerInput(tx, session, fixtureId),
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const owner = { session, fixture: fixtureId };
      await indexRunnerFixture(tx, owner, fixture);
      await bindJobInputs(tx, {
        jobId,
        owner,
        level: 1,
        primary: "hidden",
        custom: [],
        caseCount: 1,
        sampleCount: 0,
        privateDetails: true,
        submitCasesAreSamples: false,
      });
    }),
  );
  const job = {
    jobId,
    submissionId: submission,
    attemptId,
    sandboxScope: "promotion-test",
    language: "python",
    runtimeRevision: "python-3.12-v1",
    harnessRevision: "quorem-harness-v2",
    sourceRef: submission,
    suiteRef: version,
    problemVersionId: version,
    limits: {
      wallTimeMs: 2000,
      memoryBytes: 268435456,
      outputBytes: 65536,
      maxProcesses: 16,
      maxCollectionElements: 10000,
      maxNestingDepth: 100,
    },
  };
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const source = postgresVerificationSource(run);
  const verifier = nodeResultVerifier(
    {
      inputs: postgresInputReader(run),
      frozenCase: (id) => source.frozenCase(id),
      fieldPage: (id, field, offset) => source.fieldPage(id, field, offset),
      async putField(id, field, chunks) {
        let ordinal = 0;
        for await (const chunk of chunks) await source.putChunk(id, field, ordinal++, chunk);
      },
    },
    keys.privateKey,
  );
  const staging = postgresCompletionStaging(run, {
    verifier: { verify: verifier },
    verificationPublicKey: keys.publicKey,
  });
  await staging.begin(job, {
    submissionId: submission,
    attemptId,
    verdict: "wrong_answer",
    score: { passed: 0, total: 1 },
    hiddenCases: [{ index: 0, status: "wrong_answer" }],
    engineFailure: false,
    diagnosticsPresent: false,
    publicPresent: false,
    samplePresent: false,
    privatePresent: true,
    publicCount: 0,
    sampleCount: 0,
    privateCount: 1,
  });
  await staging.chunk(job, {
    channel: "private",
    ordinal: 0,
    field: "actual",
    chunkOrdinal: 0,
    bytes: new TextEncoder().encode("1"),
  });
  await staging.chunk(job, {
    channel: "private",
    ordinal: 0,
    field: "stdout",
    chunkOrdinal: 0,
    bytes: new TextEncoder().encode('"PRIVATE\\u0000OUTPUT"'),
  });
  await staging.seal(job, "private", 0, "executed");
  await staging.eof(job, job);
  const promote = postgresCompletionPromotion(run);
  await promote(job, job);
  await promote(job, job);
  const cleanup = (
    await pool.query(
      "SELECT (SELECT count(*)::int FROM execution_completion_staging WHERE job_id=$1) AS stages,(SELECT count(*)::int FROM execution_completion_frames WHERE job_id=$1) AS frames,(SELECT count(*)::int FROM execution_completion_field_chunks WHERE job_id=$1) AS chunks,(SELECT count(*)::int FROM execution_completion_receipts WHERE job_id=$1 AND outcome='completed') AS receipts",
      [jobId],
    )
  ).rows[0];
  assert.deepEqual(cleanup, { stages: 0, frames: 0, chunks: 0, receipts: 1 });
  const staff = await repo.interview(host, session, submission);
  assert.match(staff, /PRIVATE\\u0000OUTPUT/);
  assert.match(staff, /"expected":2/);
  assert.doesNotMatch(await repo.interview(alice, session, submission), /PRIVATE|"expected":2/);
  await pool.query(
    "INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES($1,$2,'hidden:0')",
    [session, questionEpoch],
  );
  const revealed = await repo.interview(alice, session, submission);
  assert.match(revealed, /PRIVATE\\u0000OUTPUT/);
  assert.match(revealed, /"expected":2/);
  await pool.query("UPDATE submissions SET result=NULL WHERE id=$1", [submission]);
  const retained = (
    await pool.query(
      "SELECT (SELECT count(*)::int FROM interview_private_result_cases WHERE submission_id=$1) AS private,(SELECT count(*)::int FROM submission_result_headers WHERE submission_id=$1) AS headers,(SELECT count(*)::int FROM submission_public_result_cases WHERE submission_id=$1) AS public",
      [submission],
    )
  ).rows[0];
  assert.deepEqual(retained, { private: 0, headers: 0, public: 0 });
  assert.doesNotMatch(await repo.interview(alice, session, submission), /PRIVATE|"expected":2/);
});
void test("streams a synthetic legacy-sized 408-case result without a Worker case plan", async () => {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'results-alice',$2,'run','','paged','running','[]')",
    [id, workspace],
  );
  await pool.query(
    "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,$2)",
    [
      id,
      Buffer.from(
        '{"verdict":"accepted","publicCasesPresent":true,"publicCaseCount":408,"channel":"public"}',
      ),
    ],
  );
  await pool.query(
    "INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) SELECT $1,'public',n,convert_to(json_build_object('index',n,'status','accepted')::text,'UTF8') FROM generate_series(0,407) n",
    [id],
  );
  await pool.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [id]);
  const value = JSON.parse(await repo.read(alice, id));
  assert.equal(value.publicCases.length, 408);
  assert.equal(value.publicCases[407].index, 407);
});
void test("classic interview fallback shares verified examples without hiding them", async () => {
  const { postgresCompletionStaging } = await import("../worker/staging.ts");
  const { postgresCompletionPromotion } = await import("../worker/promote.ts");
  const { indexRunnerFixture } = await import("../inputs/fixture.ts");
  const { bindJobInputs } = await import("../inputs/bind.ts");
  const { postgresInputReader } = await import("../inputs/read.ts");
  const { postgresVerificationSource } = await import("../worker/verification-source.ts");
  const { nodeResultVerifier } =
    await import("../../../../../../runner/src/verification/verifier.ts");
  const session = crypto.randomUUID(),
    epoch = crypto.randomUUID(),
    documentEpoch = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    attemptId = crypto.randomUUID();
  const limits = {
    wallTimeMs: 2000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  };
  const fixture = JSON.stringify({
    problem: {
      id: version,
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      constraints: [],
      limits,
      examples: [{ args: [], expected: 2 }],
    },
    hiddenCases: [],
  });
  await pool.query(
    "INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES($1,'results-host','fallback','{}','python','',$2,$3,$4,$4,$5,$5)",
    [session, documentEpoch, epoch, crypto.randomUUID(), crypto.randomUUID()],
  );
  await pool.query(
    "INSERT INTO interview_members(session_id,user_id,role) VALUES($1,'results-host','interviewer'),($1,'results-alice','interviewee')",
    [session],
  );
  const fixtureId = (
    await pool.query(
      "WITH f AS (SELECT $2::jsonb AS value) INSERT INTO interview_question_snapshots(session_id,id,fixture) SELECT $1,sha256(convert_to(value::text,'UTF8')),value FROM f RETURNING id",
      [session, fixture],
    )
  ).rows[0].id;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,'results-alice',${session}::uuid,'submit','','hash','running','[]')`,
      );
      await tx.execute(
        sql`INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level) VALUES(${submission}::uuid,${session}::uuid,1,${documentEpoch}::uuid,${epoch}::uuid,${fixtureId}::bytea,1)`,
      );
      await tx.execute(
        sql`INSERT INTO execution_jobs(id,submission_id,attempt_id,sandbox_scope,lease_until,attempts) VALUES(${jobId}::uuid,${submission}::uuid,${attemptId}::uuid,'fallback-test',clock_timestamp()+interval '1 minute',1)`,
      );
    }),
  );
  const { backfillHistoricalRunnerInput } =
    await import("../../interviews/runner-inputs/legacy-backfill.ts");
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      await backfillHistoricalRunnerInput(tx, session, fixtureId);
      const owner = { session, fixture: fixtureId };
      await indexRunnerFixture(tx, owner, fixture);
      await bindJobInputs(tx, {
        jobId,
        owner,
        level: 1,
        primary: "example",
        custom: [],
        caseCount: 1,
        sampleCount: 1,
        privateDetails: true,
        submitCasesAreSamples: true,
      });
    }),
  );
  const job = {
    jobId,
    submissionId: submission,
    attemptId,
    sandboxScope: "fallback-test",
    language: "python",
    runtimeRevision: "python-3.12-v1",
    harnessRevision: "quorem-harness-v2",
    sourceRef: submission,
    suiteRef: version,
    problemVersionId: version,
    limits,
  };
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    source = postgresVerificationSource(run);
  const verify = nodeResultVerifier(
    {
      inputs: postgresInputReader(run),
      frozenCase: (id) => source.frozenCase(id),
      fieldPage: (id, field, offset) => source.fieldPage(id, field, offset),
      async putField(id, field, chunks) {
        let ordinal = 0;
        for await (const chunk of chunks) await source.putChunk(id, field, ordinal++, chunk);
      },
    },
    keys.privateKey,
  );
  const stage = postgresCompletionStaging(run, {
    verifier: { verify },
    verificationPublicKey: keys.publicKey,
  });
  await stage.begin(job, {
    submissionId: submission,
    attemptId,
    engineFailure: false,
    diagnosticsPresent: false,
    publicPresent: false,
    samplePresent: false,
    privatePresent: true,
    publicCount: 0,
    sampleCount: 0,
    privateCount: 1,
  });
  await stage.chunk(job, {
    channel: "private",
    ordinal: 0,
    field: "actual",
    chunkOrdinal: 0,
    bytes: new TextEncoder().encode("2"),
  });
  await stage.seal(job, "private", 0, "executed");
  await stage.eof(job, job);
  await postgresCompletionPromotion(run)(job, job);
  const result = JSON.parse(await repo.interview(alice, session, submission));
  assert.equal(result.verdict, "accepted");
  assert.equal(result.publicCases[0].expected, 2);
  assert.equal(result.privateCaseResults[0].caseId, "example:0");
  assert.equal(result.privateCaseResults[0].case.expected, 2);
  // Exercise the promoted sample through the current Odyssey snapshot transport.
  const { interviewSnapshotStream } = await import("../../interviews/question/stream.ts");
  const question = {
    problem: {
      id: version,
      title: "Feedback",
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      odyssey: { levels: [{ title: "One", statementMarkdown: "One", methods: [] }] },
    },
  };
  await pool.query("UPDATE interviews SET question=$2::jsonb WHERE id=$1", [
    session,
    JSON.stringify(question),
  ]);
  await pool.query(
    "INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) VALUES($1,$2,0,convert_to('[]','UTF8')),($1,$2,1,convert_to('[]','UTF8'))",
    [session, epoch],
  );
  const snapshot = interviewSnapshotStream(run);
  for (const actor of [host, alice]) {
    const value = JSON.parse(await new Response(await snapshot(actor, session)).text());
    assert.deepEqual(value.question.progress.caseStatuses, [{ index: 0, status: "accepted" }]);
  }
});
void test("status backfill scans retained case pages and preserves case index and NUL", async () => {
  const { backfillOnePublicStatus } = await import("./status-backfill.ts");
  const { evaluatedStatusPlan, nextEvaluatedStatus, evaluatedStatusPage } =
    await import("./evaluated-status.ts");
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,odyssey_level) VALUES($1,'results-alice',$2,'run','','status-backfill','running','[]',1)",
    [id, workspace],
  );
  await pool.query(
    "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,$2)",
    [id, Buffer.from('{"publicCasesPresent":true,"publicCaseCount":1,"channel":"public"}')],
  );
  await pool.query(
    `INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) SELECT $1,'public',0,convert_to('{"index":7,"status":"wrong\\u0000answer","actual":"'||repeat('x',2097152)||'"}','UTF8')`,
    [id],
  );
  await pool.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [id]);
  const read = () =>
    run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 5000, lockTimeoutMs: 1000, isolation: "repeatable read" },
        async (tx) => {
          const criteria = {
            kind: "workspace" as const,
            workspaceId: workspace,
            owner: "results-alice",
          };
          const plan = await evaluatedStatusPlan(tx, criteria),
            row = await nextEvaluatedStatus(tx, criteria, -1);
          if (!row) return [];
          assert.equal(plan.count, 1);
          return [
            {
              index: row.index,
              status: JSON.parse(new TextDecoder().decode(await evaluatedStatusPage(tx, row, 0))),
            },
          ];
        },
      ),
    );
  await assert.rejects(read(), /require backfill/);
  assert.equal(
    await operatorRun((scope) =>
      scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
        backfillOnePublicStatus(tx, id),
      ),
    ),
    true,
  );
  assert.equal(
    await operatorRun((scope) =>
      scope.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, (tx) =>
        backfillOnePublicStatus(tx, id),
      ),
    ),
    false,
  );
  const statuses = await read();
  assert.deepEqual(statuses, [{ index: 7, status: "wrong\u0000answer" }]);
  const plan = () =>
    run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 5000, lockTimeoutMs: 1000, isolation: "repeatable read" },
        (tx) =>
          evaluatedStatusPlan(tx, {
            kind: "workspace",
            workspaceId: workspace,
            owner: "results-alice",
          }),
      ),
    );
  const before = await plan();
  await pool.query("UPDATE submissions SET result=result WHERE id=$1", [id]);
  const after = await plan();
  assert.equal(after.count, before.count);
  assert.notEqual(after.digest, before.digest);
  await assert.rejects(
    pool.query("UPDATE submission_public_case_statuses SET status_json=$2 WHERE submission_id=$1", [
      id,
      Buffer.from('"accepted"'),
    ]),
    /immutable/,
  );
  await assert.rejects(
    pool.query("DELETE FROM submission_public_case_statuses WHERE submission_id=$1", [id]),
    /immutable/,
  );
});
