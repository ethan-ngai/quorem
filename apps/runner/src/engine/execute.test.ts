/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLimits,
  decodeManifestCheckpointFrame,
  languageRuntime,
  type Checkpoint,
  type CheckpointCase,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionSpec,
  type ExecutionInputReader,
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
  const encode = (value: string) => new TextEncoder().encode(value);
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const source = encode(spec.source),
    metadata = encode(spec.problemJson),
    cases = [...spec.cases, ...(spec.submitCasesAreSamples ? [] : spec.submitSamples)].map(encode);
  const levels = (JSON.parse(spec.problemJson) as { odyssey?: { levels: unknown[] } }).odyssey
    ?.levels.length;
  const refs = cases.map((data, i) => ({
    hash: hash(data),
    size: data.length,
    channel:
      spec.kind === "run" || spec.submitCasesAreSamples
        ? ("public" as const)
        : i < spec.cases.length
          ? ("private" as const)
          : ("sample" as const),
  }));
  const manifest = {
    kind: spec.kind,
    level: levels ?? null,
    caseCount: spec.cases.length,
    sampleCount: spec.submitSamples.length,
    privateDetails: spec.privateDetails,
    submitCasesAreSamples: spec.submitCasesAreSamples,
    source: { hash: hash(source), size: source.length },
    metadata: { hash: hash(metadata), size: metadata.length },
    suiteHash: "a".repeat(64),
  };
  const port = {
    inputManifest: async () => manifest,
    inputCaseRef: async (_job: Job, ordinal: number) => refs[ordinal],
    inputPage: async (_job: Job, kind: string, ordinal: number, offset: number) => {
      const data = kind === "source" ? source : kind === "metadata" ? metadata : cases[ordinal];
      return {
        bytes: data.subarray(offset, offset + 65536),
        hash: hash(data),
        size: data.length,
        channel: kind === "case" ? refs[ordinal].channel : null,
      };
    },
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
  } as unknown as ExecutionRepository & ExecutionInputReader;
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
          const parts: Uint8Array[] = [];
          for await (const chunk of request.input.open()) parts.push(chunk);
          const raw = new TextDecoder().decode(Buffer.concat(parts)),
            value = JSON.parse(raw);
          assert.ok(!raw.includes('"expected"'));
          operations.push(value.operation ?? "direct");
          return sandbox.runCase(request, signal);
        },
      };
      const header = await executeAndStage(job, fixture.port, observed);
      assert.equal(header.publicCount, 2, language);
      assert.deepEqual(fixture.seals, ["public:0:executed", "public:1:executed"], language);
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
        .fixture.seals[0],
      "public:0:executed",
    );
    assert.equal(
      (await run("not valid !", basic, ['{"args":[],"expected":7}', '{"args":[],"expected":7}']))
        .fixture.seals[0],
      "public:0:syntax_error",
    );
    assert.equal(
      (
        await run(
          "class Solution:\n def f(self):\n  while True: pass",
          basic,
          ['{"args":[],"expected":7}'],
          200,
        )
      ).fixture.seals[0],
      "public:0:time_limit",
    );
    const large = "x".repeat(1024 * 1024);
    const largeResult = await run(
      "class Solution:\n def f(self,x): return len(x)",
      { signature: { ...sig, parameters: [{ name: "x", type: "str" }] } },
      [JSON.stringify({ args: [large], expected: large.length })],
    );
    assert.equal(largeResult.fixture.seals[0], "public:0:executed");
    const nul = await run(
      'class Solution:\n def f(self): return "a\\x00b"',
      { signature: { ...sig, returnType: "str" } },
      ['{"args":[],"expected":"a\\u0000b"}'],
    );
    assert.equal(nul.fixture.seals[0], "public:0:executed");
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
    assert.equal(sequenceResult.fixture.seals[0], "public:0:executed");
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
    assert.equal((await executeAndStage(job, fixture.port, sandbox)).publicCount, 2);
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
    assert.notEqual(decodeManifestCheckpointFrame(fixture.frames[0]).frame.status, "executed");
  },
);
