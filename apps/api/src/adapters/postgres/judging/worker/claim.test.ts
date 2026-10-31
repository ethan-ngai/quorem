import { assertRunnerFixture } from "./test-db.ts";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { postgresClaims } from "./claim.ts";
import { postgresCheckpoints } from "./checkpoints.ts";
import { postgresCompletionStaging } from "./staging.ts";
import { postgresCompletionPromotion } from "./promote.ts";
import { validateFieldChunks } from "./field-validation.ts";
import { submissionSnapshots } from "../results/repository.ts";
import {
  manifestCheckpointProvenance,
  decodeJudgeFrame,
  encodeManifestCheckpointFrame,
} from "@quorem/execution";
import { postgresInputReader } from "../inputs/read.ts";
import { localVerifier, sealFixture } from "./manifest-fixture.ts";
const url = process.env.QUOREM_RUNNER_TEST_DATABASE_URL;
assertRunnerFixture(url ?? "postgres://127.0.0.1/quorem_hono_runner_test", [
  "/quorem_hono_runner_test",
  "/quorem_hono_engine_test",
]);
describe.skipIf(!url)("runner claim fences", () => {
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  let verifier: Awaited<ReturnType<typeof localVerifier>>;
  const claims = postgresClaims(run, {
    inputProtocol: "manifest-v1",
    resumable: true,
    losslessCases: true,
    losslessResults: true,
  });
  const id = crypto.randomUUID(),
    user = `runner-${id}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID();
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    verifier = await localVerifier(run);
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    const limits = {
      wallTimeMs: 2000,
      memoryBytes: 268435456,
      outputBytes: 65536,
      maxProcesses: 16,
      maxCollectionElements: 10000,
      maxNestingDepth: 100,
    };
    await pool.query(
      'INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,\'Fixture\',\'easy\',\'\',\'{"className":"Solution","methodName":"f","parameters":[],"returnType":"int"}\'::jsonb,\'[]\'::jsonb,$3::jsonb,\'\')',
      [version, problem, JSON.stringify(limits)],
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
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[{\"expected\":2}]'::jsonb)",
      [submission, user, workspace],
    );
    await pool.query(
      "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
      [job, submission],
    );
    await sealFixture(run, version, job, [{ args: [], expected: 2 }]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM execution_jobs WHERE submission_id=$1", [submission]);
    await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await verifier.close();
    await pool.end();
  });
  it("claims once, rejects wrong scope and requires the exact expired attempt proof", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claims.claimAfterTeardown(true, "scope-a", null)),
    );
    const won = results.filter(Boolean);
    expect(won).toHaveLength(1);
    const first = won[0]!;
    expect(await claims.lease(first, true)).toBe(true);
    await pool.query(
      "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job],
    );
    expect(await claims.lease(first, true)).toBe(false);
    expect(await claims.nextExpiredAttempt(true, "scope-b")).toBeNull();
    const proof = await claims.nextExpiredAttempt(true, "scope-a");
    expect(proof).toEqual({ attemptId: first.attemptId, sandboxScope: "scope-a" });
    await expect(claims.claimAfterTeardown(true, "scope-b", proof)).rejects.toThrow();
    expect(
      await claims.claimAfterTeardown(true, "scope-a", {
        ...proof!,
        attemptId: crypto.randomUUID(),
      }),
    ).toBeNull();
    const second = await claims.claimAfterTeardown(true, "scope-a", proof);
    expect(second?.attemptId).not.toBe(first.attemptId);
    expect(await claims.lease(first, true)).toBe(false);
    expect(await claims.lease(second!, false)).toBe(true);
  });
  it("samples expiration after waiting for a row lock", async () => {
    const current = (
      await pool.query("SELECT attempt_id::text,sandbox_scope FROM execution_jobs WHERE id=$1", [
        job,
      ])
    ).rows[0];
    const result = await claims.claimAfterTeardown(true, "scope-a", null);
    expect(result).toBeNull();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
        [job],
      );
      const pending = claims.lease(
        {
          jobId: job,
          submissionId: submission,
          attemptId: current.attempt_id,
          sandboxScope: current.sandbox_scope,
        } as never,
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("COMMIT");
      expect(await pending).toBe(false);
    } finally {
      client.release();
    }
  });
  it("saves, replays, fences and yields checkpoint progress", async () => {
    const checkpoints = postgresCheckpoints(run),
      proof = await claims.nextExpiredAttempt(true, "scope-a");
    const live = await claims.claimAfterTeardown(true, "scope-a", proof);
    expect(live).not.toBeNull();
    const rawFrame = '{"status":"executed","actual":123,"stdout":"","stderr":"","line":0}';
    const judgeFrame = decodeJudgeFrame(rawFrame),
      reader = postgresInputReader(run),
      manifest = await reader.inputManifest(live!),
      ref = await reader.inputCaseRef(live!, 0);
    const provenance = await manifestCheckpointProvenance(
      live!,
      manifest,
      ref,
      0,
      live!,
      { compilationNanos: 42n },
      judgeFrame,
    );
    const frame = encodeManifestCheckpointFrame(judgeFrame, provenance);
    await checkpoints.saveCheckpoint(live!, { ordinal: 0, frame, compilationNanos: 42n });
    await expect(
      checkpoints.saveCheckpoint(live!, { ordinal: 0, frame, compilationNanos: 42n }),
    ).rejects.toThrow("ordinal mismatch");
    await expect(checkpoints.loadCheckpoint({ ...live!, sandboxScope: "wrong" })).rejects.toThrow();
    const saved = await checkpoints.loadCheckpoint(live!);
    expect(saved.nextOrdinal).toBe(1);
    expect(saved.compilationNanos).toBe(42n);
    const replayed: string[] = [];
    await checkpoints.replayCheckpoint(live!, 1, async (_i, value) => {
      replayed.push(new TextDecoder().decode(value));
    });
    expect(replayed).toEqual([frame]);
    const staging = postgresCompletionStaging(run, verifier.verification);
    const header = {
      submissionId: submission,
      attemptId: live!.attemptId,
      engineFailure: false,
      diagnosticsPresent: false,
      publicPresent: true,
      samplePresent: false,
      privatePresent: false,
      publicCount: 1,
      sampleCount: 0,
      privateCount: 0,
    };
    await staging.begin(live!, header);
    await staging.begin(live!, header);
    await expect(staging.begin(live!, { ...header, publicCount: 2 })).rejects.toThrow("provenance");
    const chunk = {
      channel: "public" as const,
      ordinal: 0,
      field: "actual" as const,
      chunkOrdinal: 0,
      bytes: new TextEncoder().encode("1e309"),
    };
    await staging.chunk(live!, chunk);
    await staging.chunk(live!, chunk);
    const output = {
      ...chunk,
      field: "stdout" as const,
      bytes: new TextEncoder().encode('"a\\u00'),
    };
    await staging.chunk(live!, output);
    await staging.chunk(live!, {
      ...output,
      chunkOrdinal: 1,
      bytes: new TextEncoder().encode('00b"'),
    });
    await staging.chunk(live!, {
      ...chunk,
      field: "diagnostics",
      bytes: new TextEncoder().encode('[{"message":"nul\\u0000","line":1}]'),
    });
    expect(
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          validateFieldChunks(tx, job, "public", 0, 65536),
        ),
      ),
    ).toEqual(new Set(["actual", "stdout", "diagnostics"]));
    await expect(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          validateFieldChunks(tx, job, "public", 0, 2),
        ),
      ),
    ).rejects.toThrow("exceeds");
    await pool.query(
      "DELETE FROM execution_completion_field_chunks WHERE job_id=$1 AND field='diagnostics'",
      [job],
    );
    await staging.chunk(live!, {
      ...chunk,
      field: "diagnostics",
      bytes: new TextEncoder().encode('[{"message":"secret","message":"safe"}]'),
    });
    await expect(
      run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          validateFieldChunks(tx, job, "public", 0, 65536),
        ),
      ),
    ).rejects.toThrow("Duplicate");
    await expect(
      staging.chunk(live!, { ...chunk, bytes: new TextEncoder().encode("456") }),
    ).rejects.toThrow("conflict");
    await expect(staging.chunk(live!, { ...chunk, channel: "private" })).rejects.toThrow("channel");
    await expect(staging.eof(live!, live!)).rejects.toThrow("Unsealed");
    await pool.query("DELETE FROM execution_completion_field_chunks WHERE job_id=$1", [job]);
    await expect(staging.eof(live!, live!)).rejects.toThrow("Incomplete");
    const actualChunk = { ...chunk, bytes: new TextEncoder().encode("123") };
    await staging.chunk(live!, actualChunk);
    await staging.seal(live!, "public", 0, "executed");
    await staging.seal(live!, "public", 0, "executed");
    await expect(
      staging.chunk(live!, { ...actualChunk, bytes: new TextEncoder().encode("456") }),
    ).rejects.toThrow("sealed");
    await expect(staging.eof(live!, { ...live!, sandboxScope: "other" })).rejects.toThrow("fence");
    await staging.eof(live!, live!);
    await staging.eof(live!, live!);
    await checkpoints.yield(live!, live!);
    const row = (await pool.query("SELECT state FROM submissions WHERE id=$1", [submission]))
      .rows[0];
    expect(row.state).toBe("queued");
    const legacy = postgresClaims(run, {
      inputProtocol: "manifest-v1",
      resumable: false,
      losslessCases: true,
      losslessResults: true,
    });
    expect(await legacy.claimAfterTeardown(false, "scope-a", null)).toBeNull();
    const next = await claims.claimAfterTeardown(true, "scope-a", null);
    expect(next).not.toBeNull();
    await pool.query(
      "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job],
    );
  });
  it("fences completion and retains lossless results", async () => {
    const proof = await claims.nextExpiredAttempt(true, "scope-a");
    const live = await claims.claimAfterTeardown(true, "scope-a", proof);
    expect(live).not.toBeNull();
    const staging = postgresCompletionStaging(run, verifier.verification),
      promote = postgresCompletionPromotion(run);
    const result = {
      submissionId: submission,
      attemptId: live!.attemptId,
      verdict: "wrong_answer" as const,
      engineFailure: false,
      diagnosticsPresent: true,
      publicPresent: true,
      samplePresent: false,
      privatePresent: false,
      publicCount: 1,
      sampleCount: 0,
      privateCount: 0,
    };
    await expect(staging.begin({ ...live!, sandboxScope: "scope-b" }, result)).rejects.toThrow(
      "Stale",
    );
    expect(
      (await pool.query("SELECT state FROM submissions WHERE id=$1", [submission])).rows[0].state,
    ).toBe("running");
    await staging.begin(live!, result);
    await staging.chunk(live!, {
      channel: "header",
      ordinal: 0,
      field: "diagnostics",
      chunkOrdinal: 0,
      bytes: new TextEncoder().encode('[{"message":"m\\u0000n"}]'),
    });
    await staging.sealDiagnostics(live!);
    await staging.chunk(live!, {
      channel: "public",
      ordinal: 0,
      field: "stdout",
      chunkOrdinal: 0,
      bytes: new TextEncoder().encode('"a\\u0000b"'),
    });
    await staging.chunk(live!, {
      channel: "public",
      ordinal: 0,
      field: "actual",
      chunkOrdinal: 0,
      bytes: new TextEncoder().encode("123"),
    });
    await expect(
      staging.chunk(live!, {
        channel: "public",
        ordinal: 0,
        // @ts-expect-error Exercise the untrusted wire boundary.
        field: "expected",
        chunkOrdinal: 0,
        bytes: new TextEncoder().encode("987655"),
      }),
    ).rejects.toThrow("Invalid completion chunk");
    await staging.seal(live!, "public", 0, "executed");
    await staging.eof(live!, live!);
    await promote(live!, live!);
    const row = (
      await pool.query(
        "SELECT s.state,s.result,convert_from(c.result_data,'UTF8') AS payload FROM submissions s JOIN submission_public_result_cases c ON c.submission_id=s.id WHERE s.id=$1",
        [submission],
      )
    ).rows[0];
    expect(row.state).toBe("completed");
    expect(row.result.verdict).toBe("wrong_answer");
    expect(JSON.parse(row.payload)).toMatchObject({ index: 0, status: "wrong_answer" });
    expect(row.payload).toContain("\\u0000");
    expect(row.payload).toContain('"expected":2');
    expect(row.payload).not.toContain("987655");
    expect(
      Number(
        (
          await pool.query("SELECT count(*) FROM execution_completion_staging WHERE job_id=$1", [
            job,
          ])
        ).rows[0].count,
      ),
    ).toBe(0);
    const diagnostic = await pool.query(
      "SELECT convert_from(field_data,'UTF8') AS data FROM submission_result_header_fields WHERE submission_id=$1 AND field='diagnostics'",
      [submission],
    );
    expect(diagnostic.rows[0].data).toContain("\\u0000");
    await promote(live!, live!);
    await expect(
      pool.query(
        "UPDATE submission_public_result_cases SET result_data=$1 WHERE submission_id=$2",
        [new Uint8Array([1]), submission],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query(
        "INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) VALUES($1,'public',1,$2)",
        [submission, new Uint8Array([1])],
      ),
    ).rejects.toThrow("immutable");
    expect(
      (await pool.query("SELECT finished FROM execution_jobs WHERE id=$1", [job])).rows[0].finished,
    ).toBe(true);
    await pool.query("UPDATE submissions SET result=NULL WHERE id=$1", [submission]);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM submission_public_result_cases WHERE submission_id=$1",
            [submission],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM submission_result_headers WHERE submission_id=$1",
            [submission],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
  });
  it("settles actual running cancellation only after the fenced owner completes", async () => {
    const s = crypto.randomUUID(),
      j = crypto.randomUUID();
    try {
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]'::jsonb)",
        [s, user, workspace],
      );
      await pool.query(
        "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
        [j, s],
      );
      await sealFixture(run, version, j, [{ args: [], expected: 2 }]);
      const live = await claims.claimAfterTeardown(true, "scope-a", null);
      expect(live).not.toBeNull();
      const snapshot = submissionSnapshots(run),
        who = {
          kind: "local" as const,
          userId: user,
          displayName: "Fixture",
          admin: false,
          emailVerified: true,
          sessionId: "fixture",
          strongUntil: 0,
        };
      const cancelled = JSON.parse(await snapshot.cancel(who, s, "cancel"));
      expect(cancelled.state).toBe("running");
      expect(await claims.lease(live!, true)).toBe(false);
      expect(
        (await pool.query("SELECT finished FROM execution_jobs WHERE id=$1", [j])).rows[0].finished,
      ).toBe(false);
      const staging = postgresCompletionStaging(run, verifier.verification);
      await staging.begin(live!, {
        submissionId: s,
        attemptId: live!.attemptId,
        engineFailure: true,
        diagnosticsPresent: false,
        publicPresent: false,
        samplePresent: false,
        privatePresent: false,
        publicCount: 0,
        sampleCount: 0,
        privateCount: 0,
      });
      await staging.eof(live!, live!);
      await postgresCompletionPromotion(run)(live!, live!);
      expect(
        (await pool.query("SELECT state FROM submissions WHERE id=$1", [s])).rows[0].state,
      ).toBe("cancelled");
      expect(
        (await pool.query("SELECT finished FROM execution_jobs WHERE id=$1", [j])).rows[0].finished,
      ).toBe(true);
    } finally {
      await pool.query("DELETE FROM cancellation_idempotency WHERE owner_id=$1", [user]);
      await pool.query("DELETE FROM execution_jobs WHERE id=$1", [j]);
      await pool.query("DELETE FROM submissions WHERE id=$1", [s]);
    }
  });
  it("serializes result insertion against concurrent terminal publication", async () => {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','running','[]')",
      [id, user, workspace],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [id]);
      const pending = pool.query(
        "/* runner-guard-fixture */ INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,$2)",
        [id, new Uint8Array([1])],
      );
      const rejected = expect(pending).rejects.toThrow("immutable");
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (
          await pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '/* runner-guard-fixture */%' AND wait_event_type='Lock') AS waiting",
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await client.query("COMMIT");
      await rejected;
    } finally {
      client.release();
      await pool.query("DELETE FROM submissions WHERE id=$1", [id]);
    }
  });
  it("clears temporary completion data when another terminal writer finishes", async () => {
    const submissionId = crypto.randomUUID(),
      jobId = crypto.randomUUID();
    try {
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]')",
        [submissionId, user, workspace],
      );
      await pool.query(
        "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
        [jobId, submissionId],
      );
      await sealFixture(run, version, jobId, [{ args: [], expected: 2 }]);
      const live = await claims.claimAfterTeardown(true, "scope-a", null);
      expect(live?.jobId).toBe(jobId);
      await postgresCompletionStaging(run, verifier.verification).begin(live!, {
        submissionId,
        attemptId: live!.attemptId,
        engineFailure: false,
        diagnosticsPresent: false,
        publicPresent: false,
        samplePresent: false,
        privatePresent: false,
        publicCount: 0,
        sampleCount: 0,
        privateCount: 0,
      });
      await pool.query("UPDATE submissions SET state='cancelled' WHERE id=$1", [submissionId]);
      await pool.query("UPDATE execution_jobs SET finished=true WHERE id=$1", [jobId]);
      expect(
        Number(
          (
            await pool.query("SELECT count(*) FROM execution_completion_staging WHERE job_id=$1", [
              jobId,
            ])
          ).rows[0].count,
        ),
      ).toBe(0);
    } finally {
      await pool.query("DELETE FROM execution_jobs WHERE id=$1", [jobId]);
      await pool.query("DELETE FROM submissions WHERE id=$1", [submissionId]);
    }
  });
  it("rejects a Go judge without manifest capability before a supported claim", async () => {
    const s = crypto.randomUUID(),
      j = crypto.randomUUID();
    try {
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]'::jsonb)",
        [s, user, workspace],
      );
      await pool.query(
        "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
        [j, s],
      );
      await sealFixture(run, version, j, [{ args: [], expected: 2 }]);
      const root = fileURLToPath(new URL("../../../../..", import.meta.url));
      expect(() =>
        execFileSync("go", ["run", "./src/adapters/postgres/judging/worker/testdata/goclaim"], {
          cwd: root,
          env: {
            ...process.env,
            QUOREM_LOSSLESS_CASES: "true",
            QUOREM_LOSSLESS_RESULT_WRITES: "true",
          },
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).toThrow("runner input protocol required");
      const next = await claims.claimAfterTeardown(true, "scope-go", null);
      expect(next?.jobId).toBe(j);
    } finally {
      await pool.query("DELETE FROM execution_jobs WHERE id=$1", [j]);
      await pool.query("DELETE FROM submissions WHERE id=$1", [s]);
    }
  }, 30000);
});
