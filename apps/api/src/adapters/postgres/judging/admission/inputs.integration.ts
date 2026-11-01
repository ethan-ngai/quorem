/** @file inputs.integration.ts @description Isolated normalized admission conformance. @module judging */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
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
  connectionTimeoutMs: 3000,
  idleTimeoutMs: 1000,
  onIdleError: () => {},
});
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
  withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
const receipts = prearmReceipts(run, "execution");
const version = crypto.randomUUID(),
  problem = crypto.randomUUID(),
  workspace = crypto.randomUUID(),
  workerWorkspace = crypto.randomUUID(),
  missingVersion = crypto.randomUUID(),
  missingProblem = crypto.randomUUID(),
  missingWorkspace = crypto.randomUUID();
const principal: LocalPrincipal = {
  kind: "local",
  userId: "input-owner",
  displayName: "Owner",
  admin: false,
  emailVerified: true,
  sessionId: "fixture",
  strongUntil: 0,
};
const makeFence = async () => {
  const receiptId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    shard = 17;
  await receipts.create(receiptId, shard);
  return { receiptId, jobId, shard };
};
const command = (kind: "run" | "submit", extra: Record<string, unknown> = {}) =>
  parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspace, kind, source: "return 1", ...extra }),
    crypto.randomUUID(),
  );
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, "product", resolve("../../apps/api/migrations"));
  await pool.query(
    "INSERT INTO users(id,display_name) VALUES('input-owner','Owner'),('input-worker','Worker')",
  );
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,'input-large'),($2,'input-missing')", [
    problem,
    missingProblem,
  ]);
  const signature = JSON.stringify({
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "x", type: "str" }],
    returnType: "int",
  });
  await pool.query(
    `WITH c AS (SELECT '{"args":["'||repeat('x',1400000)||chr(92)||'u0000"],"expected":1}' AS value), fixture AS (SELECT convert_to('{"problem":{"signature":'||$3||',"constraints":[],"limits":{},"examples":[{"args":["sample"],"expected":1}]},"hiddenCases":['||repeat(c.value||',',99)||c.value||']}', 'UTF8') AS data FROM c) INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) SELECT $1,$2,1,'Large','easy','',$3::jsonb,'[]','{}','',data FROM fixture`,
    [version, problem, signature],
  );
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Missing','easy','',$3::jsonb,'[]','{}','')",
    [missingVersion, missingProblem, signature],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2',''),($2,'python','','python-3.12-v1','quorem-harness-v2','')",
    [version, missingVersion],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'input-owner',$3,'python'),($2,'input-worker',$3,'python'),($4,'input-owner',$5,'python')",
    [workspace, workerWorkspace, version, missingWorkspace, missingVersion],
  );
  const meta = JSON.stringify({
    signature: JSON.parse(signature),
    constraints: [],
    limits: {},
    sql: null,
  });
  await pool.query(
    "INSERT INTO runner_input_blobs(hash,data) SELECT sha256(convert_to($1,'UTF8')),convert_to($1,'UTF8')",
    [meta],
  );
  await pool.query(
    `WITH c AS (SELECT convert_to('{"args":["'||repeat('x',1400000)||chr(92)||'u0000"],"expected":1}','UTF8') AS data) INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM c`,
  );
  await pool.query(
    'INSERT INTO runner_input_blobs(hash,data) SELECT sha256(convert_to(\'{"args":["sample"],"expected":1}\',\'UTF8\')),convert_to(\'{"args":["sample"],"expected":1}\',\'UTF8\')',
  );
  await pool.query(
    "INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) SELECT $1,sha256(convert_to($2,'UTF8')),sha256(lossless_fixture) FROM problem_versions WHERE id=$1",
    [version, meta],
  );
  await pool.query(
    `WITH c AS (SELECT sha256(convert_to('{"args":["'||repeat('x',1400000)||chr(92)||'u0000"],"expected":1}','UTF8')) AS hash) INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) SELECT $1,'hidden',0,n,c.hash FROM generate_series(0,99) n CROSS JOIN c`,
    [version],
  );
  await pool.query(
    "INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) VALUES($1,'example',0,0,sha256(convert_to('{\"args\":[\"sample\"],\"expected\":1}','UTF8')))",
    [version],
  );
  await pool.query("UPDATE runner_version_inputs SET sealed=true WHERE version_id=$1", [version]);
});
after(async () => pool.end());
void test("seals a >128 MiB logical fixture without reading case bodies", async () => {
  const big = (
    await pool.query(
      "SELECT octet_length(lossless_fixture)::bigint AS n FROM problem_versions WHERE id=$1",
      [version],
    )
  ).rows[0];
  assert.ok(Number(big.n) > 128 * 1024 * 1024);
  const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true }),
    fence = await makeFence(),
    cmd = await command("submit");
  const result = await admit(principal, "submit-large", cmd, fence);
  assert.equal(result.state, "queued");
  const row = (
    await pool.query(
      "SELECT i.sealed,i.case_count,i.sample_count,i.private_details,i.submit_cases_are_samples,s.cases,jsonb_array_length(s.cases) AS legacy_cases,(SELECT count(*)::int FROM runner_job_input_cases c WHERE c.job_id=i.job_id AND c.channel='private') AS hidden,(SELECT count(*)::int FROM runner_job_input_cases c WHERE c.job_id=i.job_id AND c.channel='sample') AS samples FROM runner_job_inputs i JOIN execution_jobs j ON j.id=i.job_id JOIN submissions s ON s.id=j.submission_id WHERE i.job_id=$1",
      [fence.jobId],
    )
  ).rows[0];
  assert.deepEqual(
    [
      row.sealed,
      row.case_count,
      row.sample_count,
      row.private_details,
      row.submit_cases_are_samples,
      row.legacy_cases,
      row.hidden,
      row.samples,
    ],
    [true, 100, 1, false, false, 0, 100, 1],
  );
  const replay = await admit(principal, "submit-large", cmd, await makeFence());
  assert.equal(replay.id, result.id);
});
void test("missing index and unsupported input capability fail closed without jobs or budget changes", async () => {
  const before = (await pool.query("SELECT admission_tokens FROM users WHERE id='input-owner'"))
    .rows[0].admission_tokens;
  for (const [ws, enabled] of [
    [missingWorkspace, true],
    [workspace, false],
  ] as const) {
    const key = crypto.randomUUID(),
      fence = await makeFence(),
      cmd = await command("run", { workspaceId: ws });
    await assert.rejects(
      postgresWorkspaceAdmission(run, { losslessCases: enabled, guestExecution: true })(
        principal,
        key,
        cmd,
        fence,
      ),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 503,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM execution_jobs WHERE id=$1", [fence.jobId]))
        .rows[0].n,
      0,
    );
  }
  assert.equal(
    (await pool.query("SELECT admission_tokens FROM users WHERE id='input-owner'")).rows[0]
      .admission_tokens,
    before,
  );
});
void test("custom cases preserve lossless bytes and a failed job bind rolls back admission", async () => {
  await pool.query(
    "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id='input-owner')",
  );
  await pool.query("UPDATE submissions SET state='completed' WHERE owner_id='input-owner'");
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id='input-owner'",
  );
  const cmd = await parseWorkspaceCommand(
      `{"workspaceId":"${workspace}","kind":"run","source":"return 1","customCases":[{"args":["a\\u0000b"],"expected":-0}]}`,
      "custom",
    ),
    fence = await makeFence();
  const result = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(principal, "custom", cmd, fence);
  const raw = (
    await pool.query(
      "SELECT convert_from(b.data,'UTF8') AS value FROM runner_job_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.job_id=$1 AND c.ordinal=0",
      [fence.jobId],
    )
  ).rows[0].value;
  assert.equal(raw, cmd.customCases![0]);
  assert.match(raw, /\\u0000/);
  assert.equal(
    (await pool.query("SELECT cases FROM submissions WHERE id=$1", [result.id])).rows[0].cases
      .length,
    0,
  );
  await pool.query("UPDATE execution_jobs SET finished=true WHERE id=$1", [fence.jobId]);
  await pool.query("UPDATE submissions SET state='completed' WHERE id=$1", [result.id]);
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id='input-owner'",
  );
  const failed = await makeFence(),
    retry = await command("run"),
    before = (
      await pool.query("SELECT count(*)::int AS n FROM submissions WHERE owner_id='input-owner'")
    ).rows[0].n;
  await assert.rejects(
    postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true })(
      principal,
      "collision",
      retry,
      { ...failed, jobId: fence.jobId },
    ),
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM submissions WHERE owner_id='input-owner'"))
      .rows[0].n,
    before,
  );
  assert.equal(
    (
      await pool.query("SELECT committed_at IS NULL AS pending FROM deadline_prearms WHERE id=$1", [
        failed.receiptId,
      ])
    ).rows[0].pending,
    true,
  );
  assert.equal(
    Number(
      (await pool.query("SELECT admission_tokens FROM users WHERE id='input-owner'")).rows[0]
        .admission_tokens,
    ),
    2,
  );
});
void test("guest admission rechecks deadline under lock and revocation on idempotent replay", async () => {
  const match = crypto.randomUUID(),
    guestWorkspace = crypto.randomUUID(),
    guestUser = "input-guest",
    host = "input-host",
    token = "guest-hash";
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES($1,'Host','account'),($2,'Guest','guest')",
    [host, guestUser],
  );
  await pool.query(
    "INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES($1,'guest_concurrency',1,'fixture','test')",
    [host],
  );
  await pool.query(
    "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES($1,$2,$1::uuid::text,clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),clock_timestamp()+interval '1 hour',$3)",
    [match, host, version],
  );
  await pool.query(
    "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1),($1,$3,2)",
    [match, host, guestUser],
  );
  await pool.query(
    "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [token, guestUser, match],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$2,$3,'python','match',$4)",
    [guestWorkspace, guestUser, version, match],
  );
  const guest = {
    kind: "guest" as const,
    userId: guestUser,
    displayName: "Guest",
    admin: false as const,
    emailVerified: false as const,
    sessionId: token,
    strongUntil: 0 as const,
    credentialExpiresAt: 9999999999,
    scope: { kind: "match" as const, matchId: match },
  };
  const cmd = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: guestWorkspace, kind: "submit", source: "return 1" }),
    "guest-submit",
  );
  const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true }),
    fence = await makeFence(),
    lock = await pool.connect();
  try {
    await lock.query("BEGIN");
    await lock.query(
      "UPDATE matches SET deadline=clock_timestamp()+interval '120 milliseconds' WHERE id=$1",
      [match],
    );
    const pending = admit(guest, "late", cmd, fence);
    await new Promise((resolve) => setTimeout(resolve, 220));
    await lock.query("COMMIT");
    await assert.rejects(
      pending,
      (e: unknown) => e instanceof Error && "code" in e && e.code === "invalid_transition",
    );
  } finally {
    lock.release();
  }
  await pool.query("UPDATE matches SET deadline=clock_timestamp()+interval '1 hour' WHERE id=$1", [
    match,
  ]);
  const result = await admit(guest, "guest-submit", cmd, await makeFence());
  assert.equal(result.state, "queued");
  assert.equal(
    (
      await pool.query("SELECT sponsor_id FROM guest_execution_usage WHERE submission_id=$1", [
        result.id,
      ])
    ).rows[0].sponsor_id,
    host,
  );
  await pool.query("UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1", [
    token,
  ]);
  await assert.rejects(
    admit(guest, "guest-submit", cmd, await makeFence()),
    (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
  );
});
void test("Odyssey admission binds cumulative unlocked stages and rejects stale level", async () => {
  const { indexRunnerFixture } = await import("../inputs/fixture.ts");
  const p = crypto.randomUUID(),
    v = crypto.randomUUID(),
    w = crypto.randomUUID();
  const signature = { className: "Solution", methodName: "f", parameters: [], returnType: "int" };
  const levels = [
    { methods: [signature], examples: [{ args: [], expected: 1 }] },
    { methods: [{ ...signature, methodName: "g" }], examples: [{ args: [], expected: 2 }] },
  ];
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [p, p]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey) VALUES($1,$2,1,'Odyssey','easy','',$3::jsonb,'[]','{}','',$4::jsonb)",
    [v, p, JSON.stringify(signature), JSON.stringify({ levels })],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
    [v],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'input-owner',$2,'python')",
    [w, v],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      indexRunnerFixture(
        tx,
        { version: v },
        JSON.stringify({
          problem: { id: v, signature, constraints: [], limits: {}, odyssey: { levels } },
          hiddenCases: [],
          odysseyHiddenCases: [[{ args: [], expected: 11 }], [{ args: [], expected: 22 }]],
        }),
      ),
    ),
  );
  await pool.query(
    "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,2)",
    [w, v],
  );
  const { customValidationMetadata } = await import("./core.ts");
  const { validateExecutionCases } =
    await import("../../../../modules/judging/admission/select-cases.ts");
  const first = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      customValidationMetadata(tx, { version: v }, 1),
    ),
  );
  assert.equal(first.odyssey?.levels.length, 1);
  assert.throws(() =>
    validateExecutionCases(first, 1, ['{"args":[],"calls":[{"methodName":"g","args":[]}]}']),
  );
  const second = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      customValidationMetadata(tx, { version: v }, 2),
    ),
  );
  assert.doesNotThrow(() =>
    validateExecutionCases(second, 2, ['{"args":[],"calls":[{"methodName":"g","args":[]}]}']),
  );
  const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true });
  const make = async (level: number) =>
    parseWorkspaceCommand(
      JSON.stringify({ workspaceId: w, kind: "submit", source: "x", level }),
      crypto.randomUUID(),
    );
  await assert.rejects(
    admit(principal, "stage-stale", await make(1), await makeFence()),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "revision_conflict",
  );
  const fence = await makeFence();
  await admit(principal, "stage-current", await make(2), fence);
  const items = (
    await pool.query(
      "SELECT c.channel,convert_from(b.data,'UTF8') AS raw FROM runner_job_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.job_id=$1 ORDER BY c.ordinal",
      [fence.jobId],
    )
  ).rows;
  assert.deepEqual(
    items.map((x) => x.channel),
    ["private", "private", "sample", "sample"],
  );
  assert.deepEqual(
    items.map((x) => JSON.parse(x.raw).expected),
    [11, 22, 1, 2],
  );
});
void test("SQL custom input uses the canonical schema before storing its manifest", async () => {
  const { indexRunnerFixture } = await import("../inputs/fixture.ts");
  await pool.query(
    "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id='input-owner')",
  );
  await pool.query("UPDATE submissions SET state='completed' WHERE owner_id='input-owner'");
  await pool.query(
    "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id='input-owner'",
  );
  const p = crypto.randomUUID(),
    v = crypto.randomUUID(),
    w = crypto.randomUUID(),
    config = {
      dialect: "postgresql",
      outputOrder: "unordered",
      tables: [{ name: "items", columns: [{ name: "id", type: "integer" }] }],
      output: [{ name: "id", type: "integer" }],
    };
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [p, p]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config) VALUES($1,$2,1,'SQL','easy','','{}','[]','{}','',$3::jsonb)",
    [v, p, JSON.stringify(config)],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'postgresql','','postgresql-17.6-v1','quorem-postgresql-v1','')",
    [v],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'input-owner',$2,'postgresql')",
    [w, v],
  );
  const sample = {
    args: [{ tables: [{ name: "items", rows: [[1]] }] }],
    expected: { rows: [[1]] },
  };
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      indexRunnerFixture(
        tx,
        { version: v },
        JSON.stringify({
          problem: {
            id: v,
            signature: {},
            constraints: [],
            limits: {},
            sql: config,
            examples: [sample],
          },
          hiddenCases: [sample],
        }),
      ),
    ),
  );
  const runSql = async (key: string, cases: unknown[]) =>
    postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true })(
      principal,
      key,
      await parseWorkspaceCommand(
        JSON.stringify({
          workspaceId: w,
          kind: "run",
          source: "SELECT id FROM items",
          customCases: cases,
        }),
        key,
      ),
      await makeFence(),
    );
  await assert.rejects(
    runSql("bad-sql", [{ args: [{ tables: [{ name: "other", rows: [[1]] }] }] }]),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "invalid_input",
  );
  const ok = await runSql("good-sql", [{ args: [{ tables: [{ name: "items", rows: [[1]] }] }] }]);
  assert.equal(ok.state, "queued");
});
void test("custom validator metadata excludes large prose and descriptions", async () => {
  const { customValidationMetadata } = await import("./core.ts");
  const p = crypto.randomUUID(),
    v = crypto.randomUUID();
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [p, p]);
  await pool.query(
    `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Metadata','easy','',jsonb_build_object('className','Solution','methodName','f','returnType','int','description',repeat('x',6000000),'parameters',jsonb_build_array(jsonb_build_object('name','x','type','int','description',repeat('y',6000000)))),jsonb_build_array(jsonb_build_object('kind','prose','text',repeat('z',6000000)),jsonb_build_object('kind','range','target',jsonb_build_object('parameter','x','projection','value'),'min',0,'max',2)),'{}','')`,
    [v, p],
  );
  const metadata = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      customValidationMetadata(tx, { version: v }),
    ),
  );
  assert.ok(JSON.stringify(metadata).length < 1000);
  assert.equal(metadata.constraints.length, 1);
  const { validateExecutionCases } =
    await import("../../../../modules/judging/admission/select-cases.ts");
  assert.doesNotThrow(() => validateExecutionCases(metadata, 0, ['{"args":[1]}']));
  assert.throws(() => validateExecutionCases(metadata, 0, ['{"args":[3]}']));
  assert.equal(metadata.signature.methodName, "f");
  assert.equal("description" in metadata.signature, false);
  const bad = crypto.randomUUID(),
    badProblem = crypto.randomUUID();
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [badProblem, badProblem]);
  await pool.query(
    `INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Oversized','easy','',jsonb_build_object('className','Solution','methodName',repeat('m',6000000),'returnType','int','parameters','[]'::jsonb),'[]','{}','')`,
    [bad, badProblem],
  );
  await assert.rejects(
    run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        customValidationMetadata(tx, { version: bad }),
      ),
    ),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 503,
  );
});
