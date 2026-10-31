/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLimits,
  decodeCheckpointFrame,
  languageRuntime,
  type Checkpoint,
  type CheckpointCase,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionSpec,
  type Job,
} from "@quorem/execution";
import { dockerSandbox } from "../sandbox/docker.ts";
import { executeAndStage, ExecutionYield } from "./execute.ts";
const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
function repository(spec: ExecutionSpec) {
  const frames: string[] = [],
    chunks = new Map<string, Uint8Array[]>(),
    seals: string[] = [];
  let checkpoint: Checkpoint = { nextOrdinal: 0, compilationNanos: 0n },
    header: CompletionHeader | undefined;
  const port = {
    load: async () => spec,
    loadCheckpoint: async () => checkpoint,
    saveCheckpoint: async (_job: Job, item: CheckpointCase) => {
      assert.equal(item.ordinal, frames.length);
      frames.push(item.frame);
      checkpoint = {
        nextOrdinal: frames.length,
        artifact: item.artifact ?? checkpoint.artifact,
        compilationNanos: item.compilationNanos,
        fatal: item.fatal,
      };
    },
    replayCheckpoint: async (
      _job: Job,
      count: number,
      consume: (ordinal: number, data: Uint8Array) => Promise<void>,
    ) => {
      assert.equal(count, frames.length);
      for (let i = 0; i < count; i++) await consume(i, new TextEncoder().encode(frames[i]));
    },
    beginCompletion: async (_job: Job, value: CompletionHeader) => {
      header = value;
    },
    writeCompletionChunk: async (_job: Job, item: CompletionFieldChunk) => {
      const k = `${item.channel}:${item.ordinal}:${item.field}`,
        v = chunks.get(k) ?? [];
      assert.equal(item.chunkOrdinal, v.length);
      v.push(item.bytes);
      chunks.set(k, v);
    },
    sealCompletionFrame: async (_job: Job, channel: string, index: number, status: string) => {
      seals.push(`${channel}:${index}:${status}`);
    },
  } as unknown as ExecutionRepository;
  return { port, frames, chunks, seals, header: () => header };
}
void test(
  "real Docker executes and stages all five existing harnesses",
  { skip: !socket, timeout: 180000 },
  async (t) => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-engine-fence-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "fixture-engines",
      cleanupMs: 10000,
    });
    for (const [language, source] of [
      ["python", "class Solution:\n def f(self): return 7"],
      ["java", "class Solution { public int f(){return 7;} }"],
      ["typescript", "class Solution { f():number {return 7;} }"],
      ["ocaml", "let f () = 7"],
      ["postgresql", "SELECT 7 AS n"],
    ] as const) {
      const runtime = languageRuntime(language)!;
      const sql = language === "postgresql";
      const problem = sql
        ? {
            sql: {
              dialect: "postgresql",
              outputOrder: "ordered",
              output: [{ name: "n", type: "integer" }],
            },
            signature: {
              className: "Solution",
              methodName: "f",
              parameters: [],
              returnType: "int",
            },
          }
        : {
            signature: {
              className: "Solution",
              methodName: "f",
              parameters: [],
              returnType: "int",
            },
          };
      const item = sql
        ? '{"args":[{"tables":[]}],"expected":{"rows":[[7]]}}'
        : '{"args":[],"expected":7}';
      const spec: ExecutionSpec = {
        problemJson: JSON.stringify(problem),
        source,
        kind: "run",
        cases: [item, item],
        submitSamples: [],
        submitCasesAreSamples: false,
        privateDetails: false,
      };
      const fixture = repository(spec),
        job: Job = {
          jobId: randomUUID(),
          submissionId: randomUUID(),
          attemptId: randomUUID(),
          sandboxScope: sandbox.scope,
          language,
          problemVersionId: randomUUID(),
          runtimeRevision: runtime.revision,
          harnessRevision: runtime.harness,
          sourceRef: "fixture",
          suiteRef: "fixture",
          limits: defaultLimits(),
        };
      const operations: string[] = [];
      const observed = {
        ...sandbox,
        runCase: async (request: Parameters<typeof sandbox.runCase>[0], signal?: AbortSignal) => {
          const raw = new TextDecoder().decode(request.input),
            value = JSON.parse(raw);
          assert.ok(!raw.includes('"expected"'));
          operations.push(value.operation ?? "direct");
          return sandbox.runCase(request, signal);
        },
      };
      const header = await executeAndStage(job, fixture.port, observed);
      assert.equal(header.verdict, "accepted", language);
      assert.deepEqual(fixture.seals, ["public:0:accepted", "public:1:accepted"], language);
      assert.equal(fixture.frames.length, 2);
      if (!["python", "postgresql"].includes(language))
        assert.deepEqual(
          operations,
          ["compile-execute", "execute"],
          `${language} reuses compilation`,
        );
      else assert.deepEqual(operations, ["direct", "direct"]);
    }
  },
);
void test(
  "real Python failure, timeout, NUL and Odyssey paths",
  { skip: !socket, timeout: 90000 },
  async (t) => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-engine-fence-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "fixture-engine-faults",
      cleanupMs: 10000,
    });
    const runtime = languageRuntime("python")!;
    const run = async (source: string, problem: unknown, cases: string[], wallTimeMs = 2000) => {
      const spec: ExecutionSpec = {
        problemJson: JSON.stringify(problem),
        source,
        kind: "run",
        cases,
        submitSamples: [],
        submitCasesAreSamples: false,
        privateDetails: false,
      };
      const fixture = repository(spec),
        job: Job = {
          jobId: randomUUID(),
          submissionId: randomUUID(),
          attemptId: randomUUID(),
          sandboxScope: sandbox.scope,
          language: "python",
          problemVersionId: randomUUID(),
          runtimeRevision: runtime.revision,
          harnessRevision: runtime.harness,
          sourceRef: "fixture",
          suiteRef: "fixture",
          limits: { ...defaultLimits(), wallTimeMs },
        };
      const header = await executeAndStage(job, fixture.port, sandbox);
      return { header, fixture };
    };
    const sig = { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      basic = { signature: sig };
    assert.equal(
      (await run("class Solution:\n def f(self): return 9", basic, ['{"args":[],"expected":7}']))
        .header.verdict,
      "wrong_answer",
    );
    assert.equal(
      (await run("not valid !", basic, ['{"args":[],"expected":7}', '{"args":[],"expected":7}']))
        .header.verdict,
      "syntax_error",
    );
    assert.equal(
      (
        await run(
          "class Solution:\n def f(self):\n  while True: pass",
          basic,
          ['{"args":[],"expected":7}'],
          200,
        )
      ).header.verdict,
      "time_limit",
    );
    const large = "x".repeat(1024 * 1024);
    const largeResult = await run(
      "class Solution:\n def f(self,x): return len(x)",
      { signature: { ...sig, parameters: [{ name: "x", type: "str" }] } },
      [JSON.stringify({ args: [large], expected: large.length })],
    );
    assert.equal(largeResult.header.verdict, "accepted");
    const nul = await run(
      'class Solution:\n def f(self): return "a\\x00b"',
      { signature: { ...sig, returnType: "str" } },
      ['{"args":[],"expected":"a\\u0000b"}'],
    );
    assert.equal(nul.header.verdict, "accepted");
    assert.equal(
      new TextDecoder().decode(nul.fixture.chunks.get("public:0:actual")![0]),
      '"a\\u0000b"',
    );
    const add = {
      className: "Solution",
      methodName: "add",
      parameters: [{ name: "v", type: "int" }],
      returnType: "int",
    };
    const sequence = { signature: add, odyssey: { levels: [{ methods: [add] }] } };
    const sequenceResult = await run(
      "class Solution:\n def __init__(self): self.n=0\n def add(self,v):\n  self.n+=v\n  return self.n",
      sequence,
      [
        '{"args":[],"calls":[{"methodName":"add","args":[2],"expected":2},{"methodName":"add","args":[3],"expected":5}]}',
      ],
    );
    assert.equal(sequenceResult.header.verdict, "accepted");
  },
);
void test(
  "case boundary yields only after a durable checkpoint and resumes",
  { skip: !socket, timeout: 60000 },
  async (t) => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-engine-yield-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "yield",
      cleanupMs: 10000,
    });
    const runtime = languageRuntime("python")!;
    const spec: ExecutionSpec = {
      problemJson: JSON.stringify({
        signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      }),
      source: "class Solution:\n def f(self): return 7",
      kind: "run",
      cases: ['{"args":[],"expected":7}', '{"args":[],"expected":7}'],
      submitSamples: [],
      submitCasesAreSamples: false,
      privateDetails: false,
    };
    const fixture = repository(spec),
      job: Job = {
        jobId: randomUUID(),
        submissionId: randomUUID(),
        attemptId: randomUUID(),
        sandboxScope: sandbox.scope,
        language: "python",
        problemVersionId: randomUUID(),
        runtimeRevision: runtime.revision,
        harnessRevision: runtime.harness,
        sourceRef: "source",
        suiteRef: "suite",
        limits: defaultLimits(),
      };
    let boundaries = 0;
    await assert.rejects(
      executeAndStage(job, fixture.port, sandbox, undefined, () => ++boundaries > 0),
      ExecutionYield,
    );
    assert.equal(fixture.frames.length, 1);
    assert.equal((await executeAndStage(job, fixture.port, sandbox)).verdict, "accepted");
    assert.equal(fixture.frames.length, 2);
  },
);
void test("a forged sandbox result cannot create a checkpoint", async () => {
  const runtime = languageRuntime("python")!,
    spec: ExecutionSpec = {
      problemJson: JSON.stringify({
        signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
      }),
      source: "class Solution: pass",
      kind: "run",
      cases: ['{"args":[],"expected":7}'],
      submitSamples: [],
      submitCasesAreSamples: false,
      privateDetails: false,
    };
  const fixture = repository(spec),
    job: Job = {
      jobId: "job",
      submissionId: "submission",
      attemptId: "attempt",
      sandboxScope: "scope",
      language: "python",
      problemVersionId: "problem",
      runtimeRevision: runtime.revision,
      harnessRevision: runtime.harness,
      sourceRef: "source",
      suiteRef: "suite",
      limits: defaultLimits(),
    };
  const forged = {
    runCase: async () => ({
      stdout: new TextEncoder().encode('\0{"status":"executed","actual":7}'),
      stderr: new Uint8Array(),
      exitCode: 0,
    }),
    teardownAttempt: async () => {},
  };
  await assert.rejects(executeAndStage(job, fixture.port, forged), /Unconfirmed/);
  assert.equal(fixture.frames.length, 0);
  const { CaseDeadline } = await import("../sandbox/budget.ts");
  await assert.rejects(
    executeAndStage(job, fixture.port, {
      ...forged,
      runCase: async () => {
        throw new CaseDeadline("case");
      },
    }),
    /Unconfirmed/,
  );
  assert.equal(fixture.frames.length, 0);
});
void test(
  "SQL contestant cannot read PostgreSQL server files",
  { skip: !socket, timeout: 60000 },
  async (t) => {
    const stateRoot = await realpath(await mkdtemp(join(tmpdir(), "quorem-sql-security-")));
    t.after(() => rm(stateRoot, { recursive: true, force: true }));
    const sandbox = await dockerSandbox({
      socket: socket!,
      stateRoot,
      namespace: "sql-security",
      cleanupMs: 10000,
    });
    const runtime = languageRuntime("postgresql")!;
    const problem = {
      sql: {
        dialect: "postgresql",
        outputOrder: "ordered",
        output: [{ name: "n", type: "integer" }],
      },
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
    };
    const spec: ExecutionSpec = {
      problemJson: JSON.stringify(problem),
      source: "SELECT pg_read_file('/etc/passwd') AS n",
      kind: "run",
      cases: ['{"args":[{"tables":[]}],"expected":{"rows":[[1]]}}'],
      submitSamples: [],
      submitCasesAreSamples: false,
      privateDetails: false,
    };
    const fixture = repository(spec),
      job: Job = {
        jobId: randomUUID(),
        submissionId: randomUUID(),
        attemptId: randomUUID(),
        sandboxScope: sandbox.scope,
        language: "postgresql",
        problemVersionId: randomUUID(),
        runtimeRevision: runtime.revision,
        harnessRevision: runtime.harness,
        sourceRef: "source",
        suiteRef: "suite",
        limits: defaultLimits(),
      };
    assert.notEqual((await executeAndStage(job, fixture.port, sandbox)).verdict, "accepted");
    assert.notEqual(decodeCheckpointFrame(fixture.frames[0]).frame.status, "executed");
  },
);
