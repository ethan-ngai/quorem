import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { postgresClaims } from "./claim.ts";
import { postgresCheckpoints } from "./checkpoints.ts";
import { postgresCompletionStaging } from "./staging.ts";
import { postgresCompletionPromotion } from "./promote.ts";
import { submissionSnapshots } from "../results/repository.ts";
const url = process.env.QUOREM_RUNNER_TEST_DATABASE_URL;
const parsed = new URL(url ?? "postgres://127.0.0.1:55464/quorem_hono_runner_test");
if (
  parsed.port !== "55464" ||
  parsed.pathname !== "/quorem_hono_runner_test" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
)
  throw new Error("Disposable runner database required");
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
  const claims = postgresClaims(run, {
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
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','','{}'::jsonb,'[]'::jsonb,$3::jsonb,'')",
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
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run','','hash','queued','[]'::jsonb)",
      [submission, user, workspace],
    );
    await pool.query(
      "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
      [job, submission],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM execution_jobs WHERE submission_id=$1", [submission]);
    await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
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
    const frame = '{"status":"executed","actual":123,"stdout":"","stderr":"","line":0}';
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
    const staging = postgresCompletionStaging(run);
    const header = {
      submissionId: submission,
      attemptId: live!.attemptId,
      publicPresent: true,
      samplePresent: false,
      privatePresent: false,
      publicCount: 1,
      sampleCount: 0,
      privateCount: 0,
    };
    await staging.begin(live!, header);
    await staging.begin(live!, header);
    const chunk = {
      channel: "public" as const,
      ordinal: 0,
      field: "actual" as const,
      chunkOrdinal: 0,
      bytes: new TextEncoder().encode("123"),
    };
    await staging.chunk(live!, chunk);
    await staging.chunk(live!, chunk);
    await expect(
      staging.chunk(live!, { ...chunk, bytes: new TextEncoder().encode("456") }),
    ).rejects.toThrow("conflict");
    await expect(staging.chunk(live!, { ...chunk, channel: "private" })).rejects.toThrow("channel");
    await expect(staging.eof(live!, live!)).rejects.toThrow("Unsealed");
    await pool.query("DELETE FROM execution_completion_field_chunks WHERE job_id=$1", [job]);
    await expect(staging.eof(live!, live!)).rejects.toThrow("Incomplete");
    const resultFrame = {
      channel: "public" as const,
      ordinal: 0,
      raw: '{"index":0,"status":"accepted","actual":9007199254740993}',
    };
    await staging.frame(live!, resultFrame);
    await staging.frame(live!, resultFrame);
    await expect(
      staging.frame(live!, { ...resultFrame, raw: '{"index":0,"status":"wrong_answer"}' }),
    ).rejects.toThrow("conflict");
    await expect(staging.eof(live!, { ...live!, sandboxScope: "other" })).rejects.toThrow("fence");
    await staging.eof(live!, live!);
    await staging.eof(live!, live!);
    await checkpoints.yield(live!);
    const row = (await pool.query("SELECT state FROM submissions WHERE id=$1", [submission]))
      .rows[0];
    expect(row.state).toBe("queued");
    const legacy = postgresClaims(run, {
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
    const staging = postgresCompletionStaging(run),
      promote = postgresCompletionPromotion(run);
    const result = {
      submissionId: submission,
      attemptId: live!.attemptId,
      verdict: "accepted" as const,
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
    await staging.frame(live!, {
      channel: "public",
      ordinal: 0,
      raw: '{"index":0,"status":"accepted","actual":"a\\u0000b"}',
    });
    await staging.eof(live!, live!);
    await promote(live!, live!);
    const row = (
      await pool.query(
        "SELECT s.state,s.result,convert_from(c.result_data,'UTF8') AS payload FROM submissions s JOIN submission_public_result_cases c ON c.submission_id=s.id WHERE s.id=$1",
        [submission],
      )
    ).rows[0];
    expect(row.state).toBe("completed");
    expect(row.result.publicCases).toEqual([{ index: 0, status: "accepted" }]);
    expect(row.payload).toContain("\\u0000");
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
      const staging = postgresCompletionStaging(run);
      await staging.begin(live!, {
        submissionId: s,
        attemptId: live!.attemptId,
        engineFailure: "cancelled",
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
      await expect(pending).rejects.toThrow("immutable");
    } finally {
      client.release();
      await pool.query("DELETE FROM submissions WHERE id=$1", [id]);
    }
  });
  it("accepts and reclaims a real Go judge attempt with the same fences", async () => {
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
      const root = fileURLToPath(new URL("../../../../..", import.meta.url));
      const raw = execFileSync(
        "go",
        ["run", "./src/adapters/postgres/judging/worker/testdata/goclaim"],
        {
          cwd: root,
          env: {
            ...process.env,
            QUOREM_LOSSLESS_CASES: "true",
            QUOREM_LOSSLESS_RESULT_WRITES: "true",
          },
          encoding: "utf8",
        },
      );
      const go = JSON.parse(raw) as {
        jobId: string;
        submissionId: string;
        attemptId: string;
        language: string;
        runtimeRevision: string;
        harnessRevision: string;
      };
      expect(go.jobId).toBe(j);
      expect(go.submissionId).toBe(s);
      expect(go.language).toBe("python");
      expect(go.runtimeRevision).toBe("python-3.12-v1");
      expect(go.harnessRevision).toBe("quorem-harness-v2");
      await pool.query(
        "UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [j],
      );
      const proof = await claims.nextExpiredAttempt(true, "scope-go");
      expect(proof).toEqual({ attemptId: go.attemptId, sandboxScope: "scope-go" });
      const next = await claims.claimAfterTeardown(true, "scope-go", proof);
      expect(next?.jobId).toBe(j);
      expect(next?.attemptId).not.toBe(go.attemptId);
    } finally {
      await pool.query("DELETE FROM execution_jobs WHERE id=$1", [j]);
      await pool.query("DELETE FROM submissions WHERE id=$1", [s]);
    }
  }, 30000);
});
