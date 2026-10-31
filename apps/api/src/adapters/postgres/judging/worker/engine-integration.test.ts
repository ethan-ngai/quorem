import { assertRunnerFixture } from "./test-db.ts";
/** @file engine-integration.test.ts @description Real queue, sandbox and resume provenance. @module judging */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import {
  checkpointProvenance,
  encodeCheckpointFrame,
  decodeCheckpointFrame,
  compressCheckpointFrame,
  decompressCheckpointFrame,
  type JudgeFrame,
} from "@quorem/execution";
import { postgresExecutionCommands } from "./repository.ts";
import { dockerSandbox } from "../../../../../../runner/src/sandbox/docker.ts";
import { executeAndStage } from "../../../../../../runner/src/engine/execute.ts";
import {
  finishAfterTeardown,
  yieldAfterTeardown,
} from "../../../../../../runner/src/queue/finish.ts";
const url = process.env.QUOREM_ENGINE_TEST_DATABASE_URL,
  socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
if (url) assertRunnerFixture(url, ["/quorem_hono_engine_test"]);
describe.skipIf(!url || !socket)("real checkpoint provenance and engine integration", () => {
  let stateRoot: string;
  const pool = createNodePool({
    connectionString: url!,
    max: 6,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  const port = postgresExecutionCommands(run, {
    resumable: true,
    losslessCases: true,
    losslessResults: true,
  });
  const id = crypto.randomUUID(),
    user = `engine-${id}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  beforeAll(async () => {
    stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-engine-pg-fence-")));
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    const signature = { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      limits = {
        wallTimeMs: 2000,
        memoryBytes: 268435456,
        outputBytes: 65536,
        maxProcesses: 16,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      };
    await pool.query(
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','',$3::jsonb,'[]',$4::jsonb,'')",
      [version, problem, JSON.stringify(signature), JSON.stringify(limits)],
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
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run',$4,'hash','queued',$5::jsonb)",
      [
        submission,
        user,
        workspace,
        "class Solution:\n def f(self): return 7",
        JSON.stringify([
          { args: [], expected: 7 },
          { args: [], expected: 7 },
        ]),
      ],
    );
    await pool.query(
      "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
      [jobId, submission],
    );
  }, 30000);
  afterAll(async () => {
    await pool.query("DELETE FROM execution_jobs WHERE id=$1", [jobId]);
    await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.end();
    await rm(stateRoot, { recursive: true, force: true });
  });
  it("rejects altered bindings, resumes the original attempt prefix and promotes", async () => {
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "engine-pg-fixture",
      cleanupMs: 10000,
    });
    const first = await port.claimAfterTeardown(true, sandbox.scope, null);
    expect(first?.jobId).toBe(jobId);
    let invoked = 0;
    const interrupted = {
      ...sandbox,
      runCase: async (...args: Parameters<typeof sandbox.runCase>) => {
        if (++invoked === 2) throw new Error("fixture interrupt");
        return sandbox.runCase(...args);
      },
    };
    await expect(executeAndStage(first!, port, interrupted)).rejects.toThrow("fixture interrupt");
    expect((await port.loadCheckpoint(first!)).nextOrdinal).toBe(1);
    const stored = (
      await pool.query(
        "SELECT frame FROM execution_checkpoint_cases WHERE job_id=$1 AND ordinal=0",
        [jobId],
      )
    ).rows[0].frame as Uint8Array;
    const decoded = decodeCheckpointFrame(
      new TextDecoder().decode(await decompressCheckpointFrame(stored)),
    );
    const forged = encodeCheckpointFrame({ ...decoded.frame, actual: "9" }, decoded.provenance);
    await pool.query(
      "UPDATE execution_checkpoint_cases SET frame=$2 WHERE job_id=$1 AND ordinal=0",
      [jobId, await compressCheckpointFrame(new TextEncoder().encode(forged))],
    );
    await expect(port.loadCheckpoint(first!)).rejects.toThrow("provenance");
    await pool.query(
      "UPDATE execution_checkpoint_cases SET frame=$2 WHERE job_id=$1 AND ordinal=0",
      [jobId, stored],
    );
    await yieldAfterTeardown(port, sandbox, first!);
    const next = await port.claimAfterTeardown(true, sandbox.scope, null);
    expect(next?.jobId).toBe(jobId);
    expect(next!.attemptId).not.toBe(first!.attemptId);
    const spec = await port.load(next!),
      frame: JudgeFrame = { status: "executed", actual: "7", stdout: "", stderr: "", line: 0 },
      metadata = { compilationNanos: 0n };
    const wrong = await checkpointProvenance(
      next!,
      { ...spec, source: spec.source + " " },
      1,
      next!,
      metadata,
      frame,
    );
    await expect(
      port.saveCheckpoint(next!, {
        ordinal: 1,
        frame: encodeCheckpointFrame(frame, wrong),
        ...metadata,
      }),
    ).rejects.toThrow("provenance");
    const oldAttempt = await checkpointProvenance(next!, spec, 1, first!, metadata, frame);
    await expect(
      port.saveCheckpoint(next!, {
        ordinal: 1,
        frame: encodeCheckpointFrame(frame, oldAttempt),
        ...metadata,
      }),
    ).rejects.toThrow("fence");
    await expect(port.load({ ...next!, sourceRef: "forged" })).rejects.toThrow();
    await expect(port.load({ ...next!, runtimeRevision: "python-forged" })).rejects.toThrow();
    await expect(port.load({ ...next!, sandboxScope: "other" })).rejects.toThrow();
    const caseChanged = await checkpointProvenance(
      next!,
      { ...spec, cases: [spec.cases[0], '{"args":[],"expected":8}'] },
      1,
      next!,
      metadata,
      frame,
    );
    await expect(
      port.saveCheckpoint(next!, {
        ordinal: 1,
        frame: encodeCheckpointFrame(frame, caseChanged),
        ...metadata,
      }),
    ).rejects.toThrow("provenance");
    let runs = 0;
    const observed = {
      ...sandbox,
      runCase: async (...args: Parameters<typeof sandbox.runCase>) => {
        runs++;
        return sandbox.runCase(...args);
      },
    };
    const header = await executeAndStage(next!, port, observed);
    expect(header.verdict).toBe("accepted");
    expect(runs).toBe(1);
    await finishAfterTeardown(port, sandbox, next!);
    const row = (await pool.query("SELECT state,result FROM submissions WHERE id=$1", [submission]))
      .rows[0];
    expect(row.state).toBe("completed");
    expect(row.result.publicCases).toHaveLength(2);
  }, 90000);
  it("reuses a database-persisted compiled artifact only after bound-prefix validation", async () => {
    const submissionId = crypto.randomUUID(),
      executionId = crypto.randomUUID(),
      compiledWorkspace = crypto.randomUUID();
    try {
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'typescript','','typescript-5.9.3-node-22.21.1-v1','quorem-typescript-v1','')",
        [version],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'typescript')",
        [compiledWorkspace, user, version],
      );
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'run',$4,'hash','queued',$5::jsonb)",
        [
          submissionId,
          user,
          compiledWorkspace,
          "class Solution { f():number {return 7;} }",
          JSON.stringify([
            { args: [], expected: 7 },
            { args: [], expected: 7 },
          ]),
        ],
      );
      await pool.query(
        "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'typescript','typescript-5.9.3-node-22.21.1-v1','quorem-typescript-v1')",
        [executionId, submissionId],
      );
      const sandbox = await dockerSandbox({
          socket: socket!,
          stateRoot,
          namespace: "engine-pg-compiled",
          cleanupMs: 10000,
        }),
        first = await port.claimAfterTeardown(true, sandbox.scope, null);
      expect(first?.jobId).toBe(executionId);
      let calls = 0;
      const interrupted = {
        ...sandbox,
        runCase: async (...args: Parameters<typeof sandbox.runCase>) => {
          if (++calls === 2) throw new Error("fixture interrupt");
          return sandbox.runCase(...args);
        },
      };
      await expect(executeAndStage(first!, port, interrupted)).rejects.toThrow("fixture interrupt");
      expect((await port.loadCheckpoint(first!)).artifact).toBeTruthy();
      const saved = (
        await pool.query(
          "SELECT artifact::text AS artifact,compilation_nanos::text AS nanos FROM execution_checkpoints WHERE job_id=$1",
          [executionId],
        )
      ).rows[0];
      await pool.query(
        "UPDATE execution_checkpoints SET artifact=jsonb_set(artifact,'{files,main.js}','\"AA==\"'::jsonb) WHERE job_id=$1",
        [executionId],
      );
      await expect(port.loadCheckpoint(first!)).rejects.toThrow("provenance");
      await pool.query(
        "UPDATE execution_checkpoints SET artifact=$2::jsonb,compilation_nanos=compilation_nanos+1 WHERE job_id=$1",
        [executionId, saved.artifact],
      );
      await expect(port.loadCheckpoint(first!)).rejects.toThrow("provenance");
      await pool.query(
        "UPDATE execution_checkpoints SET compilation_nanos=$2::bigint WHERE job_id=$1",
        [executionId, saved.nanos],
      );
      await yieldAfterTeardown(port, sandbox, first!);
      const next = await port.claimAfterTeardown(true, sandbox.scope, null);
      let operation = "";
      const observed = {
        ...sandbox,
        runCase: async (...args: Parameters<typeof sandbox.runCase>) => {
          operation = JSON.parse(new TextDecoder().decode(args[0].input)).operation;
          return sandbox.runCase(...args);
        },
      };
      expect((await executeAndStage(next!, port, observed)).verdict).toBe("accepted");
      expect(operation).toBe("execute");
      await finishAfterTeardown(port, sandbox, next!);
    } finally {
      await pool.query("DELETE FROM execution_jobs WHERE id=$1", [executionId]);
      await pool.query("DELETE FROM submissions WHERE id=$1", [submissionId]);
      await pool.query("DELETE FROM workspaces WHERE id=$1", [compiledWorkspace]);
      await pool.query(
        "DELETE FROM problem_languages WHERE version_id=$1 AND language='typescript'",
        [version],
      );
    }
  }, 90000);
});
