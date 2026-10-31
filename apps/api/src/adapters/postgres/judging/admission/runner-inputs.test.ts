import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLosslessJson } from "@quorem/questions";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import {
  createActiveRunnerFixture,
  setActiveRunnerFixture,
} from "../../interviews/runner-inputs/active.ts";
import { saveInterviewFixture } from "../../interviews/execution/fixture.ts";
import { persistQuestionVersion } from "../../problems/publication.ts";
import { languageRuntime, defaultLimits, type Job } from "@quorem/execution";
import { createRunnerCommandHandler } from "../worker/http.ts";
import { postgresExecutionLoad } from "../worker/load.ts";
import { postgresCompletionStaging } from "../worker/staging.ts";
import { postgresVerificationPrepare } from "../worker/verification-prepare.ts";
import { postgresVerificationSource } from "../worker/verification-source.ts";
import { postgresVerificationCommit } from "../worker/verification-commit.ts";
import { createVerificationSourceHandler } from "../worker/verification-http.ts";
import { httpResultVerifier } from "../worker/verification-client.ts";
import { httpVerificationSource } from "../../../../../../runner/src/verification/source-http.ts";
import { verificationHandler } from "../../../../../../runner/src/verification/http.ts";
import { verifiedMatchProgress } from "../worker/verified-progress.ts";
import { nodeResultVerifier } from "../../../../../../runner/src/verification/verifier.ts";
import { verifyResultReceipt } from "@quorem/execution";
import { postgresCompletionPromotion } from "../worker/promote.ts";
import { postgresExecutionCommands } from "../worker/repository.ts";
import { privateRunnerCommands } from "../../../../../../runner/src/queue/http.ts";
import { spoolInput } from "../../../../../../runner/src/checkpoints/input-spool.ts";
import { manifestCaseIdentity, manifestCasePage } from "../inputs/identity.ts";
import { postgresInputReader } from "../inputs/read.ts";
import { bindJobInputs, fixtureRows } from "../inputs/bind.ts";
import { fixtureSourceHash } from "../inputs/source.ts";
import { indexRunnerFixture, encodeFixtureCase, encodeFixtureMetadata } from "../inputs/fixture.ts";
import { sql } from "drizzle-orm";
const url = process.env.QUOREM_ENGINE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.pathname !== "/quorem_hono_engine_test" ||
    ["host", "hostaddr", "service"].some((key) => u.searchParams.has(key))
  )
    throw new Error("Disposable engine database required");
}
describe.skipIf(!url)("immutable runner input SQL", () => {
  it("seals ordered fixture references, rejects changes, and keeps job inputs fenced", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const problem = crypto.randomUUID(),
        version = crypto.randomUUID();
      await client.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
      await client.query(
        "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','','{}','[]','{}','')",
        [version, problem],
      );
      const meta = Buffer.from('{"signature":{}}'),
        value = Buffer.from('{"args":[]}');
      const b = await client.query(
        "INSERT INTO runner_input_blobs(hash,data) VALUES(sha256($1::bytea),$1),(sha256($2::bytea),$2) RETURNING hash",
        [meta, value],
      );
      await client.query(
        "INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) VALUES($1,$2,$2)",
        [version, b.rows[0].hash],
      );
      await client.query(
        "INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) VALUES($1,'example',0,0,$2)",
        [version, b.rows[1].hash],
      );
      await client.query("UPDATE runner_version_inputs SET sealed=true WHERE version_id=$1", [
        version,
      ]);
      await client.query("SAVEPOINT immutable");
      await expect(
        client.query(
          "INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) VALUES($1,'example',0,1,$2)",
          [version, b.rows[1].hash],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT immutable");
      await client.query("SAVEPOINT immutable_blob");
      await expect(
        client.query("UPDATE runner_input_blobs SET data=$1 WHERE hash=$2", [
          value,
          b.rows[0].hash,
        ]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT immutable_blob");
      await client.query("SAVEPOINT version_retention");
      await expect(
        client.query("DELETE FROM runner_version_inputs WHERE version_id=$1", [version]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT version_retention");
      await client.query("DELETE FROM problem_versions WHERE id=$1", [version]);
      expect(
        (await client.query("SELECT 1 FROM runner_version_inputs WHERE version_id=$1", [version]))
          .rowCount,
      ).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });
  it("indexes lossless fixture cases once and rejects conflicting replay", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID();
    const raw = JSON.stringify({
      problem: {
        id: version,
        signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
        examples: [{ args: ["x\u0000y"], expected: 1 }],
      },
      hiddenCases: [{ args: [2], expected: 3 }],
      odysseyHiddenCases: [],
    });
    try {
      await withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
          await tx.execute(
            sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy',repeat('x',4194304),'{}','[]','{}','')`,
          );
          await indexRunnerFixture(tx, { version }, raw);
          await indexRunnerFixture(tx, { version }, raw);
          const cases = (
            await tx.execute<{ raw: string }>(
              sql`SELECT convert_from(b.data,'UTF8') AS raw FROM runner_version_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.version_id=${version}::uuid ORDER BY c.channel`,
            )
          ).rows;
          expect(cases).toHaveLength(2);
          expect(cases[0].raw).toContain("\\u0000");
          await expect(
            indexRunnerFixture(tx, { version }, raw.replace('"expected":3', '"expected":4')),
          ).rejects.toThrow("Conflicting runner fixture");
        }),
      );
    } finally {
      await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
      await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
      await pool.end();
    }
  });
  it("indexes real published fixture in the publication transaction", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const raw = readFileSync(
      new URL("../../../../../../../fixtures/problems/run-widths.json", import.meta.url),
      "utf8",
    );
    const problem = crypto.randomUUID(),
      version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 20000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,'run-widths')`,
            );
            await persistQuestionVersion(tx, raw, problem, version, 3, null, (language) => {
              const value = languageRuntime(language);
              return value ? { revision: value.revision, harness: value.harness } : undefined;
            });
            const indexed = (
              await tx.execute<{ sealed: boolean; n: number }>(
                sql`SELECT i.sealed,count(c.ordinal)::int AS n FROM runner_version_inputs i JOIN runner_version_input_cases c ON c.version_id=i.version_id WHERE i.version_id=${version}::uuid GROUP BY i.sealed`,
              )
            ).rows[0];
            expect(indexed.sealed).toBe(true);
            expect(indexed.n).toBeGreaterThan(1);
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("indexes an immutable interview snapshot in the same transaction", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const session = crypto.randomUUID(),
      host = `index-host-${session}`,
      epoch = crypto.randomUUID();
    const raw = JSON.stringify({
      problem: { examples: [{ args: ["a\u0000b"], expected: 7 }] },
      hiddenCases: [{ args: [], expected: 7 }],
    });
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'Fixture')`);
            await tx.execute(
              sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES(${session}::uuid,${host},'Fixture','{}','python','',${epoch}::uuid,${epoch}::uuid,${session},${session},${host},${host})`,
            );
            const first = await saveInterviewFixture(tx, session, raw),
              second = await saveInterviewFixture(tx, session, raw);
            expect(first).toEqual(second);
            expect(
              Buffer.from(await fixtureSourceHash(tx, { session, fixture: first })).toString("hex"),
            ).toBe(createHash("sha256").update(raw).digest("hex"));
            const result = (
              await tx.execute<{ sealed: boolean; n: number }>(
                sql`SELECT i.sealed,count(c.ordinal)::int AS n FROM runner_snapshot_inputs i JOIN runner_snapshot_input_cases c USING(session_id,fixture_id) WHERE i.session_id=${session}::uuid GROUP BY i.sealed`,
              )
            ).rows[0];
            expect(result).toEqual({ sealed: true, n: 2 });
            await tx.execute(sql`SAVEPOINT snapshot_retention`);
            await expect(
              tx.execute(
                sql`DELETE FROM runner_snapshot_inputs WHERE session_id=${session}::uuid AND fixture_id=${first}`,
              ),
            ).rejects.toThrow();
            await tx.execute(sql`ROLLBACK TO SAVEPOINT snapshot_retention`);
            await setActiveRunnerFixture(tx, session, epoch, first);
            expect(
              (
                await tx.execute(
                  sql`SELECT 1 FROM interview_active_runner_inputs WHERE session_id=${session}::uuid`,
                )
              ).rows,
            ).toHaveLength(1);
            await tx.execute(sql`SAVEPOINT bad_epoch`);
            await expect(
              setActiveRunnerFixture(tx, session, crypto.randomUUID(), first),
            ).rejects.toThrow();
            await tx.execute(sql`ROLLBACK TO SAVEPOINT bad_epoch`);
            await tx.execute(
              sql`UPDATE interviews SET question_epoch=${crypto.randomUUID()}::uuid WHERE id=${session}::uuid`,
            );
            expect(
              (
                await tx.execute(
                  sql`SELECT 1 FROM interview_active_runner_inputs WHERE session_id=${session}::uuid`,
                )
              ).rows,
            ).toHaveLength(0);
            await tx.execute(
              sql`DELETE FROM interview_question_snapshots WHERE session_id=${session}::uuid AND id=${first}`,
            );
            expect(
              (
                await tx.execute(
                  sql`SELECT 1 FROM runner_snapshot_inputs WHERE session_id=${session}::uuid`,
                )
              ).rows,
            ).toHaveLength(0);
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("indexes a 320-case staged fixture without per-case database roundtrips", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID();
    const cases = Array.from({ length: 160 }, (_, i) => ({ args: [i], expected: i }));
    const raw = JSON.stringify({
      problem: { odyssey: { levels: [{ examples: cases, methods: [] }] } },
      odysseyHiddenCases: [cases],
    });
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 20000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`,
            );
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]','{}','')`,
            );
            await indexRunnerFixture(tx, { version }, raw);
            const rows = (
              await tx.execute<{ channel: string; count: number }>(
                sql`SELECT channel,count(*)::int AS count FROM runner_version_input_cases WHERE version_id=${version}::uuid GROUP BY channel ORDER BY channel`,
              )
            ).rows;
            expect(rows).toEqual([
              { channel: "example", count: 160 },
              { channel: "hidden", count: 160 },
            ]);
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("seals only a manifest bound to its real job, source and complete ordered cases", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const client = await pool.connect();
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID(),
      workspace = crypto.randomUUID(),
      submission = crypto.randomUUID(),
      job = crypto.randomUUID(),
      user = `owner-${crypto.randomUUID()}`;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
      await client.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
      await client.query(
        "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','','{}','[]','{}','')",
        [version, problem],
      );
      await client.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','r','h','')",
        [version],
      );
      await client.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
        [workspace, user, version],
      );
      await client.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','abc','hash','queued','[]')",
        [submission, user, workspace],
      );
      await client.query(
        "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','r','h')",
        [job, submission],
      );
      const meta = Buffer.from("{}");
      const hash = (
        await client.query(
          "INSERT INTO runner_input_blobs(hash,data) VALUES(sha256($1::bytea),$1) RETURNING hash",
          [meta],
        )
      ).rows[0].hash;
      await client.query(
        "INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) VALUES($1,$2,$2)",
        [version, hash],
      );
      await client.query("UPDATE runner_version_inputs SET sealed=true WHERE version_id=$1", [
        version,
      ]);
      await client.query(
        "INSERT INTO runner_input_blobs(hash,data) VALUES(sha256(convert_to('abc','UTF8')),convert_to('abc','UTF8'))",
      );
      await client.query(
        "INSERT INTO runner_job_inputs(job_id,version_id,metadata_hash,source_hash,runtime_revision,harness_revision,case_count,sample_count,private_details,submit_cases_are_samples) VALUES($1,$2,$3,sha256(convert_to('abc','UTF8')),'r','h',1,0,false,false)",
        [job, version, hash],
      );
      await client.query("SAVEPOINT incomplete");
      await expect(
        client.query("UPDATE runner_job_inputs SET sealed=true WHERE job_id=$1", [job]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT incomplete");
      await client.query(
        "INSERT INTO runner_job_input_cases(job_id,ordinal,channel,blob_hash) VALUES($1,0,'public',$2)",
        [job, hash],
      );
      await client.query("UPDATE runner_job_inputs SET sealed=true WHERE job_id=$1", [job]);
      await client.query("SAVEPOINT frozen");
      await expect(
        client.query("UPDATE runner_job_input_cases SET channel='private' WHERE job_id=$1", [job]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT frozen");
      await client.query("SAVEPOINT job_retention");
      await expect(
        client.query("DELETE FROM runner_job_inputs WHERE job_id=$1", [job]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT job_retention");
      await client.query("DELETE FROM execution_jobs WHERE id=$1", [job]);
      expect(
        (await client.query("SELECT 1 FROM runner_job_input_cases WHERE job_id=$1", [job]))
          .rowCount,
      ).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });
  it("atomically binds admitted source and selected fixture refs to the real job", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID(),
      workspace = crypto.randomUUID(),
      submission = crypto.randomUUID(),
      job = crypto.randomUUID(),
      user = `owner-${crypto.randomUUID()}`;
    const raw = JSON.stringify({
      problem: {
        signature: {
          className: "Solution",
          methodName: "f",
          parameters: [],
          returnType: "int",
          description: "x".repeat(150000),
        },
        examples: [{ args: [1], expected: 2 }],
      },
      hiddenCases: [{ args: [3], expected: 4 }],
    });
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Fixture')`);
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`,
            );
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]',${JSON.stringify(defaultLimits())}::jsonb,'')`,
            );
            await tx.execute(
              sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
            );
            await tx.execute(
              sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
            );
            await tx.execute(
              sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${user},${workspace}::uuid,'submit','abc','hash','queued','[]')`,
            );
            await tx.execute(
              sql`INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES(${job}::uuid,${submission}::uuid,'python','python-3.12-v1','quorem-harness-v2')`,
            );
            await indexRunnerFixture(tx, { version }, raw);
            await bindJobInputs(tx, {
              jobId: job,
              owner: { version },
              level: 0,
              primary: "hidden",
              custom: [],
              caseCount: 1,
              sampleCount: 1,
              privateDetails: false,
              submitCasesAreSamples: false,
            });
            const bound = (
              await tx.execute<{ sealed: boolean; n: number }>(
                sql`SELECT i.sealed,count(c.ordinal)::int AS n FROM runner_job_inputs i JOIN runner_job_input_cases c USING(job_id) WHERE i.job_id=${job}::uuid GROUP BY i.sealed`,
              )
            ).rows[0];
            expect(bound).toEqual({ sealed: true, n: 2 });
            const identity = await manifestCaseIdentity(tx, job, 0);
            expect(identity).toMatchObject({ caseCount: 1, sampleCount: 1, channel: "private" });
            expect(new TextDecoder().decode(await manifestCasePage(tx, job, 0, 0))).toBe(
              '{"args":[3],"expected":4}',
            );
            await expect(manifestCaseIdentity(tx, job, 2)).rejects.toThrow(
              "Runner input unavailable",
            );
            const attempt = crypto.randomUUID();
            await tx.execute(
              sql`UPDATE submissions SET state='running' WHERE id=${submission}::uuid`,
            );
            await tx.execute(sql`SAVEPOINT legacy_claim`);
            await expect(
              tx.execute(
                sql`UPDATE execution_jobs SET attempt_id=${attempt}::uuid WHERE id=${job}::uuid`,
              ),
            ).rejects.toThrow();
            await tx.execute(sql`ROLLBACK TO SAVEPOINT legacy_claim`);
            await tx.execute(
              sql`SELECT set_config('quorem.runner_input_protocol','manifest-v1',true)`,
            );
            await tx.execute(sql`SELECT set_config('quorem.sandbox_scope','scope',true)`);
            await tx.execute(
              sql`UPDATE execution_jobs SET attempt_id=${attempt}::uuid,sandbox_scope='scope',lease_until=clock_timestamp()+interval '1 minute' WHERE id=${job}::uuid`,
            );
            const reader = postgresInputReader(async (fn) =>
              fn({ transaction: async (_options, action) => action(tx) } as ConnectionScope),
            );
            const fence: Job = {
              jobId: job,
              submissionId: submission,
              attemptId: attempt,
              sandboxScope: "scope",
              problemVersionId: version,
              sourceRef: submission,
              suiteRef: version,
              language: "python",
              runtimeRevision: "python-3.12-v1",
              harnessRevision: "quorem-harness-v2",
              limits: defaultLimits(),
            };
            const manifest = await reader.inputManifest(fence);
            const refs = (
              await tx.execute<{ ordinal: number; channel: string; blob_hash: Uint8Array }>(
                sql`SELECT ordinal,channel,blob_hash FROM runner_job_input_cases WHERE job_id=${job}::uuid ORDER BY ordinal`,
              )
            ).rows;
            let digest = createHash("sha256").update("quorem-suite-v1").digest();
            for (const ref of refs) {
              const ordinal = Buffer.alloc(4);
              ordinal.writeInt32BE(ref.ordinal);
              digest = createHash("sha256")
                .update(digest)
                .update(ordinal)
                .update(ref.channel)
                .update(Buffer.of(0))
                .update(ref.blob_hash)
                .digest();
            }
            const expectedSuite = digest.toString("hex");
            expect(manifest.suiteHash).toBe(expectedSuite);
            expect(manifest).toMatchObject({
              kind: "submit",
              caseCount: 1,
              sampleCount: 1,
              privateDetails: false,
            });
            const source = await reader.inputPage(fence, "source", 0, 0);
            expect(new TextDecoder().decode(source.bytes)).toBe("abc");
            expect((await reader.inputPage(fence, "case", 0, 0)).channel).toBe("private");
            const scoped = async <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
              fn({ transaction: async (_options, action) => action(tx) } as ConnectionScope);
            const bootstrapKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
              "sign",
              "verify",
            ]);
            const secret = "fixture-only-input-page-private-credential";
            const handler = await createRunnerCommandHandler([
              {
                secret,
                scope: "scope",
                resumable: true,
                inputProtocol: "manifest-v1",
                repository: () =>
                  postgresExecutionCommands(
                    scoped,
                    {
                      resumable: true,
                      inputProtocol: "manifest-v1",
                      losslessCases: true,
                      losslessResults: true,
                    },
                    {
                      verificationPublicKey: bootstrapKeys.publicKey,
                      verifier: {
                        async verify() {
                          throw new Error("Unavailable in input-only fixture");
                        },
                      },
                    },
                  ),
              },
            ]);
            const client = privateRunnerCommands({
              origin: "https://fixture",
              secret,
              scope: "scope",
              resumable: true,
              timeoutMs: 5000,
              fetch: async (input, init) => handler(new Request(input, init)),
            });
            const overHttp = await client.inputManifest(fence);
            expect(overHttp.metadata.size).toBeGreaterThan(150000);
            const spool = await spoolInput({
              reader: client,
              job: fence,
              kind: "metadata",
              ordinal: 0,
              expected: overHttp.metadata,
            });
            let total = 0;
            for await (const chunk of spool.stream()) total += (chunk as Uint8Array).byteLength;
            expect(total).toBe(overHttp.metadata.size);
            await spool.dispose();
            await expect(postgresExecutionLoad(scoped, true)(fence)).rejects.toThrow(
              "Manifest input requires streaming verifier",
            );
            const stage = postgresCompletionStaging(scoped);
            await stage.begin(fence, {
              submissionId: submission,
              attemptId: attempt,
              verdict: "accepted",
              engineFailure: false,
              diagnosticsPresent: false,
              publicPresent: false,
              samplePresent: false,
              privatePresent: false,
              publicCount: 0,
              sampleCount: 0,
              privateCount: 0,
            });
            await tx.execute(sql`SAVEPOINT verify_test`);
            const priorHeader = (
              await tx.execute<{ header: Uint8Array }>(
                sql`SELECT header_data AS header FROM execution_completion_staging WHERE job_id=${job}::uuid`,
              )
            ).rows[0].header;
            const header = JSON.parse(new TextDecoder().decode(priorHeader));
            header.samplePresent = true;
            header.sampleCount = 1;
            const headerBytes = new TextEncoder().encode(JSON.stringify(header));
            await tx.execute(
              sql`UPDATE execution_completion_staging SET header_data=${headerBytes}::bytea,header_hash=sha256(${headerBytes}::bytea) WHERE job_id=${job}::uuid`,
            );
            const actual = new TextEncoder().encode("8");
            await tx.execute(
              sql`INSERT INTO execution_completion_field_chunks(job_id,channel,ordinal,field,chunk_ordinal,chunk_data,chunk_hash) VALUES(${job}::uuid,'sample',0,'actual',0,${actual}::bytea,sha256(${actual}::bytea))`,
            );
            const challenge = await postgresVerificationPrepare(scoped)(
              fence,
              "sample",
              0,
              "accepted",
            );
            expect(await postgresVerificationPrepare(scoped)(fence, "sample", 0, "accepted")).toBe(
              challenge,
            );
            const authority = postgresVerificationSource(scoped);
            const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
              "sign",
              "verify",
            ]);
            const verifierCredential = new Uint8Array(32).fill(3);
            const sourceCredential = new Uint8Array(32).fill(4);
            const sourceHandler = createVerificationSourceHandler(scoped, sourceCredential);
            const sourceHttp = httpVerificationSource({
              origin: "https://fixture",
              credential: sourceCredential,
              challenge,
              timeoutMs: 5000,
              fetch: async (input, init) => sourceHandler(new Request(input, init)),
            });
            const server = createServer(
              verificationHandler({
                credential: verifierCredential,
                timeoutMs: 5000,
                verify: nodeResultVerifier(sourceHttp, keys.privateKey),
              }),
            );
            server.listen(0, "127.0.0.1");
            await once(server, "listening");
            const address = server.address();
            if (!address || typeof address === "string")
              throw new Error("Missing verifier address");
            let verified: Awaited<ReturnType<ReturnType<typeof httpResultVerifier>["verify"]>>;
            try {
              const verifier = httpResultVerifier({
                origin: `http://127.0.0.1:${address.port}`,
                credential: verifierCredential,
                timeoutMs: 5000,
              });
              verified = await verifier.verify(challenge);
              await postgresCompletionStaging(scoped, {
                verifier,
                verificationPublicKey: keys.publicKey,
              }).seal(fence, "sample", 0, "accepted");
            } finally {
              server.close();
              await once(server, "close");
            }
            expect(verified.receipt.status).toBe("wrong_answer");
            expect(
              await verifyResultReceipt(verified.receipt, verified.signature, keys.publicKey),
            ).toBe(true);
            await expect(
              authority.putChunk(challenge, "actual", 0, new TextEncoder().encode("9")),
            ).rejects.toThrow("Verification output conflict");
            const commit = postgresVerificationCommit(scoped, keys.publicKey);
            await expect(
              commit({ ...verified.receipt, status: "accepted" }, verified.signature),
            ).rejects.toThrow("Invalid verification signature");
            await tx.execute(
              sql`UPDATE submissions SET cancel_requested=true WHERE id=${submission}::uuid`,
            );
            await expect(commit(verified.receipt, verified.signature)).rejects.toThrow(
              "Verification unavailable",
            );
            await tx.execute(
              sql`UPDATE submissions SET cancel_requested=false WHERE id=${submission}::uuid`,
            );
            await commit(verified.receipt, verified.signature);
            await commit(verified.receipt, verified.signature);
            const saved = (
              await tx.execute<{ status: string; raw: string }>(
                sql`SELECT status,convert_from(frame_data,'UTF8') AS raw FROM execution_completion_frames WHERE job_id=${job}::uuid AND channel='sample' AND ordinal=0`,
              )
            ).rows[0];
            expect(saved.status).toBe("wrong_answer");
            expect(JSON.parse(saved.raw)).toMatchObject({
              status: "wrong_answer",
              actual: 8,
              expected: 2,
            });
            expect(await verifiedMatchProgress(tx, job)).toEqual({ kind: "unavailable" });
            header.privatePresent = true;
            header.privateCount = 1;
            const header2 = new TextEncoder().encode(JSON.stringify(header));
            await tx.execute(
              sql`UPDATE execution_completion_staging SET header_data=${header2}::bytea,header_hash=sha256(${header2}::bytea) WHERE job_id=${job}::uuid`,
            );
            const privateActual = new TextEncoder().encode("4");
            await tx.execute(
              sql`INSERT INTO execution_completion_field_chunks(job_id,channel,ordinal,field,chunk_ordinal,chunk_data,chunk_hash) VALUES(${job}::uuid,'private',0,'actual',0,${privateActual}::bytea,sha256(${privateActual}::bytea))`,
            );
            const privateChallenge = await postgresVerificationPrepare(scoped)(
              fence,
              "private",
              0,
              "executed",
            );
            const privateVerified = await nodeResultVerifier(
              {
                inputs: reader,
                frozenCase: authority.frozenCase,
                fieldPage: authority.fieldPage,
                async putField(id, field, chunks) {
                  let n = 0;
                  for await (const chunk of chunks) await authority.putChunk(id, field, n++, chunk);
                },
              },
              keys.privateKey,
            )(privateChallenge);
            expect(privateVerified.receipt.status).toBe("accepted");
            await commit(privateVerified.receipt, privateVerified.signature);
            expect(await verifiedMatchProgress(tx, job)).toEqual({
              kind: "verified",
              caseCount: 1,
              definiteFailures: 0,
              terminal: null,
            });
            await tx.execute(sql`SAVEPOINT terminal_test`);
            await tx.execute(sql`UPDATE execution_jobs SET finished=true WHERE id=${job}::uuid`);
            expect((await verifiedMatchProgress(tx, job)).kind).toBe("verified");
            expect(
              ((await verifiedMatchProgress(tx, job)) as { terminal: unknown }).terminal,
            ).toBeNull();
            await tx.execute(
              sql`INSERT INTO execution_completion_receipts(job_id,attempt_id,sandbox_scope,outcome) VALUES(${job}::uuid,${attempt}::uuid,'scope','completed')`,
            );
            expect(await verifiedMatchProgress(tx, job)).toEqual({
              kind: "verified",
              caseCount: 1,
              definiteFailures: 0,
              terminal: { verdict: "accepted", passed: 1 },
            });
            await tx.execute(sql`ROLLBACK TO SAVEPOINT terminal_test`);
            await stage.eof(fence, fence);
            const promote = postgresCompletionPromotion(scoped);
            await promote(fence, fence);
            await promote(fence, fence);
            const finished = (
              await tx.execute<{
                state: string;
                result: { verdict: string; score: { passed: number; total: number } };
              }>(sql`SELECT state,result FROM submissions WHERE id=${submission}::uuid`)
            ).rows[0];
            expect(finished).toMatchObject({
              state: "completed",
              result: { verdict: "accepted", score: { passed: 1, total: 1 } },
            });
            expect(
              (
                await tx.execute<{ raw: string }>(
                  sql`SELECT convert_from(field_data,'UTF8') AS raw FROM submission_result_header_fields WHERE submission_id=${submission}::uuid AND field='hiddenCases'`,
                )
              ).rows[0].raw,
            ).toContain('"accepted"');
            await tx.execute(sql`ROLLBACK TO SAVEPOINT verify_test`);
            await stage.eof(fence, fence);
            await expect(postgresCompletionPromotion(scoped)(fence, fence)).rejects.toThrow(
              "Invalid completion channels",
            );
            expect(
              (
                await tx.execute<{ state: string }>(
                  sql`SELECT state FROM submissions WHERE id=${submission}::uuid`,
                )
              ).rows[0].state,
            ).toBe("running");
            await expect(
              reader.inputPage({ ...fence, attemptId: crypto.randomUUID() }, "case", 0, 0),
            ).rejects.toThrow();
            await tx.execute(
              sql`UPDATE submissions SET cancel_requested=true WHERE id=${submission}::uuid`,
            );
            await expect(reader.inputPage(fence, "case", 0, 0)).rejects.toThrow();
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("counts a large selected index in PostgreSQL", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID();
    const raw = JSON.stringify({
      problem: { examples: Array.from({ length: 1000 }, (_, i) => ({ args: [i], expected: i })) },
      hiddenCases: [],
    });
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 15000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`,
            );
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]','{}','')`,
            );
            await indexRunnerFixture(tx, { version }, raw);
            const rows = await tx.execute<{ n: string }>(
              sql`SELECT count(*)::text AS n FROM (${fixtureRows({ version }, 0)}) f WHERE channel='example'`,
            );
            expect(rows.rows).toEqual([{ n: "1000" }]);
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("pins indexed version refs to a current interview epoch without fetching fixture bytes", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const version = crypto.randomUUID(),
      problem = crypto.randomUUID(),
      session = crypto.randomUUID(),
      epoch = crypto.randomUUID(),
      host = `pin-${session}`;
    const versionRaw = JSON.stringify({
      problem: {
        id: version,
        runtimeRevision: "python-original",
        starterSource: "original",
        examples: [{ args: [1], expected: 2 }],
      },
      hiddenCases: [{ args: [1], expected: 2 }],
    });
    const activeRaw = JSON.stringify({
      problem: {
        id: version,
        runtimeRevision: "java-selected",
        starterSource: "selected",
        examples: [{ args: [1], expected: 2 }],
      },
      hiddenCases: [],
    });
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 15000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${host},'Fixture')`);
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`,
            );
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]','{}','')`,
            );
            await indexRunnerFixture(tx, { version }, versionRaw);
            await tx.execute(
              sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) VALUES(${session}::uuid,${host},'Fixture',${activeRaw}::jsonb,'python','',${epoch}::uuid,${epoch}::uuid,${session},${session},${host},${host})`,
            );
            const first = await createActiveRunnerFixture(tx, session, epoch, version),
              second = await createActiveRunnerFixture(tx, session, epoch, version);
            expect(first).toEqual(second);
            await indexRunnerFixture(tx, { session, fixture: first }, activeRaw);
            expect(await saveInterviewFixture(tx, session, activeRaw)).toEqual(first);
            const rows = (
              await tx.execute<{ channel: string; n: number }>(
                sql`SELECT channel,count(*)::int AS n FROM runner_snapshot_input_cases WHERE session_id=${session}::uuid AND fixture_id=${first} GROUP BY channel`,
              )
            ).rows;
            expect(rows).toEqual([{ channel: "example", n: 1 }]);
            await tx.execute(
              sql`UPDATE interviews SET question_epoch=${crypto.randomUUID()}::uuid WHERE id=${session}::uuid`,
            );
            await expect(createActiveRunnerFixture(tx, session, epoch, version)).rejects.toThrow(
              "Runner fixture unavailable",
            );
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
  it("derives source hashes from persisted lossless bytes or canonical PostgreSQL JSONB", async () => {
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const problem = crypto.randomUUID(),
      version = crypto.randomUUID();
    try {
      await expect(
        withNodeConnection(pool, { lifetimeMs: 10000 }, (scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(
              sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`,
            );
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}','[]','{}','')`,
            );
            const canonical = (
              await tx.execute<{ fields: (string | null)[] }>(
                sql`SELECT ARRAY[v.id::text,v.problem_id::text,v.version::text,v.title,v.difficulty,v.statement_markdown,v.signature::text,v.constraints::text,v.limits::text,v.attribution,v.sql_config::text,(v.odyssey-'levels')::text] AS fields FROM problem_versions v WHERE v.id=${version}::uuid`,
              )
            ).rows[0].fields;
            const hash = (value: Uint8Array | string) =>
              createHash("sha256").update(value).digest();
            const metadataHash = hash(
              Buffer.concat(
                canonical.map((value) =>
                  hash(
                    value === null
                      ? Buffer.from([0])
                      : Buffer.concat([Buffer.from([1]), Buffer.from(value)]),
                  ),
                ),
              ),
            );
            const empty = hash(new Uint8Array());
            const expected = hash(
              Buffer.concat([
                Buffer.from("quorem-version-fixture-v1"),
                metadataHash,
                empty,
                empty,
                empty,
                empty,
                empty,
                empty,
                empty,
              ]),
            ).toString("hex");
            expect(Buffer.from(await fixtureSourceHash(tx, { version })).toString("hex")).toBe(
              expected,
            );
            await tx.execute(
              sql`INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES(${version}::uuid,0,'["λ"]'::jsonb,'1'::jsonb)`,
            );
            expect(Buffer.from(await fixtureSourceHash(tx, { version })).toString("hex")).not.toBe(
              expected,
            );
            const metadata = await encodeFixtureMetadata(tx, {
              id: "v",
              title: "ignored",
              signature: { returnType: "int" },
              examples: [],
            });
            expect(new TextDecoder().decode(metadata)).toBe(
              '{"id":"v","signature":{"returnType":"int"}}',
            );
            const metadataNumeric = await encodeFixtureMetadata(
              tx,
              parseLosslessJson('{"id":"v","constraints":[{"min":1e+30}],"sql":null}'),
            );
            const metadataCanonical = await encodeFixtureMetadata(
              tx,
              parseLosslessJson(
                '{"constraints":[{"min":1000000000000000000000000000000}],"id":"v"}',
              ),
            );
            expect(metadataNumeric).toEqual(metadataCanonical);
            const raw = String.raw` { "z": "λ\u0000", "n": 1e+30, "a": -0 } `;
            const losslessVersion = crypto.randomUUID();
            await tx.execute(
              sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) VALUES(${losslessVersion}::uuid,2,${problem}::uuid,'Fixture','easy','','{}','[]','{}','',${new TextEncoder().encode(raw)})`,
            );
            expect(
              Buffer.from(await fixtureSourceHash(tx, { version: losslessVersion })).toString(
                "hex",
              ),
            ).toBe(createHash("sha256").update(raw).digest("hex"));
            expect(
              new TextDecoder().decode(encodeFixtureCase({ expected: "λ\u0000", args: [] })),
            ).toBe('{"args":[],"expected":"λ\\u0000"}');
            throw new Error("fixture rollback");
          }),
        ),
      ).rejects.toThrow("fixture rollback");
    } finally {
      await pool.end();
    }
  });
});
