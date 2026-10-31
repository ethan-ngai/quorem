import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { defaultLimits } from "@quorem/execution";
import { postgresInputReader } from "../inputs/read.ts";
import { readFileSync } from "node:fs";
import { indexRunnerFixture } from "../inputs/fixture.ts";
import { questionAuthoring } from "../../problems/authoring/repository.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import { prepareExecutionInputs } from "./core.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
const url = process.env.QUOREM_SUITE_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).port !== "55574" ||
  new URL(url).pathname !== "/quorem_hono_suite_manifest_test" ||
  new URL(url).hostname !== "127.0.0.1"
)
  throw new Error("Disposable suite database required");
const pool = createNodePool({
  connectionString: url,
  max: 4,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  onIdleError: (e) => {
    throw e;
  },
});
const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
  withNodeConnection(pool, { lifetimeMs: 20000 }, fn);
after(async () => pool.end());
void test("eight valid authored stages bind 160 hidden cases and 160 examples in order", async () => {
  const user = randomUUID(),
    workspace = randomUUID();
  await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
  await pool.query(
    "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'questions.custom','manual','fixture','fixture','test')",
    [randomUUID(), user],
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../../../../fixtures/odyssey/balance-ledger.json", import.meta.url),
      "utf8",
    ),
  );
  fixture.problem.slug = `suite-${randomUUID()}`;
  const level = fixture.problem.odyssey.levels[0],
    hidden = fixture.odysseyHiddenCases[0][0];
  fixture.problem.odyssey.levels = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(level),
    examples: Array.from({ length: 20 }, () => structuredClone(level.examples[0])),
    methods:
      i === 0
        ? structuredClone(level.methods)
        : [{ ...structuredClone(level.methods[0]), methodName: `extra${i}` }],
  }));
  fixture.odysseyHiddenCases = Array.from({ length: 8 }, () =>
    Array.from({ length: 20 }, () => structuredClone(hidden)),
  );
  const authoring = questionAuthoring(run, (language) => {
    const i = fixture.implementations.find((v: { language: string }) => v.language === language);
    return i && { revision: i.runtimeRevision, harness: i.harnessRevision };
  });
  const actor = { userId: user, admin: false, globalAllowed: false };
  const draft = JSON.parse(await authoring.create(actor, JSON.stringify(fixture), undefined));
  const version = JSON.parse(await authoring.publish(actor, draft.id, "1", "private"))
    .publishedVersionId as string;
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
    [workspace, user, version],
  );
  await pool.query(
    "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,8)",
    [workspace, version],
  );
  const key = randomUUID(),
    fence = { receiptId: randomUUID(), jobId: randomUUID(), shard: 0 };
  await prearmReceipts(run, "execution").create(fence.receiptId, fence.shard);
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspace, kind: "submit", source: "x", level: 8 }),
    key,
  );
  const result = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(
    {
      kind: "local",
      userId: user,
      displayName: "Fixture",
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    },
    key,
    command,
    fence,
  );
  assert.equal(result.state, "queued");
  const manifest = (
    await pool.query(
      "SELECT case_count,sample_count,sealed FROM runner_job_inputs WHERE job_id=$1",
      [fence.jobId],
    )
  ).rows[0];
  assert.deepEqual(manifest, { case_count: 160, sample_count: 160, sealed: true });
  const rows = (
    await pool.query(
      "SELECT ordinal,channel,blob_hash FROM runner_job_input_cases WHERE job_id=$1 ORDER BY ordinal",
      [fence.jobId],
    )
  ).rows;
  assert.equal(rows.length, 320);
  assert.deepEqual(
    rows.map((r) => r.ordinal),
    Array.from({ length: 320 }, (_, i) => i),
  );
  assert.deepEqual(
    rows.map((r) => r.channel),
    [...Array(160).fill("private"), ...Array(160).fill("sample")],
  );
  let digest = createHash("sha256").update("quorem-suite-v1").digest();
  for (const row of rows) {
    const ord = Buffer.alloc(4);
    ord.writeInt32BE(row.ordinal);
    digest = createHash("sha256")
      .update(digest)
      .update(ord)
      .update(row.channel)
      .update(Buffer.of(0))
      .update(row.blob_hash)
      .digest();
  }
  const sqlDigest = (
    await pool.query("SELECT encode(quorem_suite_digest($1::uuid),'hex') AS hash", [fence.jobId])
  ).rows[0].hash;
  assert.equal(sqlDigest, digest.toString("hex"));
});
void test("legacy indexed suites above 320 bind without loading reference arrays", async () => {
  const user = randomUUID(),
    problem = randomUUID(),
    version = randomUUID(),
    workspace = randomUUID();
  const signature = {
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "x", type: "int" }],
    returnType: "int",
  };
  const levels = Array.from({ length: 8 }, (_, stage) => ({
    methods: [],
    examples: [{ args: [stage], expected: stage }],
  }));
  const hidden = Array.from({ length: 8 }, (_, stage) =>
    Array.from({ length: 50 }, (_, n) => ({ args: [stage * 50 + n], expected: stage * 50 + n })),
  );
  await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
  await pool.query("INSERT INTO problems(id,slug) VALUES($1::uuid,$1::text)", [problem]);
  await pool.query(
    "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey) VALUES($1,$2,1,'Fixture','easy','',$3,'[]',$5,'test',$4)",
    [
      version,
      problem,
      JSON.stringify(signature),
      JSON.stringify({ levels }),
      JSON.stringify(defaultLimits()),
    ],
  );
  await pool.query(
    "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
    [version],
  );
  await pool.query(
    "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
    [workspace, user, version],
  );
  await pool.query(
    "INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES($1,$2,8)",
    [workspace, version],
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 15000, lockTimeoutMs: 1000 }, (tx) =>
      indexRunnerFixture(
        tx,
        { version },
        JSON.stringify({
          problem: { signature, constraints: [], limits: {}, odyssey: { levels } },
          odysseyHiddenCases: hidden,
        }),
      ),
    ),
  );
  let maxRows = 0;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const observed = new Proxy(tx, {
        get(target, key, receiver) {
          if (key === "execute")
            return async (...args: Parameters<typeof tx.execute>) => {
              const result = await tx.execute(...args);
              maxRows = Math.max(maxRows, result.rows.length);
              return result;
            };
          return Reflect.get(target, key, receiver);
        },
      });
      const selected = await prepareExecutionInputs(
        observed,
        { version },
        "submit",
        8,
        null,
        false,
        true,
      );
      assert.equal(selected.caseCount, 400);
      assert.equal(selected.sampleCount, 8);
    }),
  );
  assert.equal(maxRows, 1);
  const key = randomUUID(),
    fence = { receiptId: randomUUID(), jobId: randomUUID(), shard: 0 };
  await prearmReceipts(run, "execution").create(fence.receiptId, 0);
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspace, kind: "submit", source: "x", level: 8 }),
    key,
  );
  const admitted = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(
    {
      kind: "local",
      userId: user,
      displayName: "Fixture",
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    },
    key,
    command,
    fence,
  );
  const manifest = (
    await pool.query(
      "SELECT case_count,sample_count,sealed FROM runner_job_inputs WHERE job_id=$1",
      [fence.jobId],
    )
  ).rows[0];
  assert.deepEqual(manifest, { case_count: 400, sample_count: 8, sealed: true });
  const rows = (
    await pool.query(
      "SELECT ordinal,channel FROM runner_job_input_cases WHERE job_id=$1 ORDER BY ordinal",
      [fence.jobId],
    )
  ).rows;
  const attempt = randomUUID(),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('quorem.runner_input_protocol','manifest-v1',true),set_config('quorem.sandbox_scope','scope',true)",
    );
    await client.query("UPDATE submissions SET state='running' WHERE id=$1", [admitted.id]);
    await client.query(
      "UPDATE execution_jobs SET attempt_id=$2,sandbox_scope='scope',lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",
      [fence.jobId, attempt],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const reader = postgresInputReader(run);
  const job = {
    jobId: fence.jobId,
    submissionId: admitted.id,
    attemptId: attempt,
    sandboxScope: "scope",
    problemVersionId: version,
    sourceRef: admitted.id,
    suiteRef: version,
    language: "python",
    runtimeRevision: "python-3.12-v1",
    harnessRevision: "quorem-harness-v2",
    limits: defaultLimits(),
  };
  assert.equal((await reader.inputCaseRef(job, 407)).channel, "sample");
  assert.ok((await reader.inputPage(job, "case", 407, 0)).bytes.length > 0);
  assert.deepEqual(
    rows.map((r) => r.ordinal),
    Array.from({ length: 408 }, (_, i) => i),
  );
  assert.deepEqual(
    rows.map((r) => r.channel),
    [...Array(400).fill("private"), ...Array(8).fill("sample")],
  );
});
