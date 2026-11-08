/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CASE_LANES,
  defaultLimits,
  decodeManifestCheckpointFrame,
  languageRuntime,
  type Checkpoint,
  type CheckpointCase,
  type CompletionFieldChunk,
  type CompletionHeader,
  type ExecutionRepository,
  type ExecutionInputReader,
  type Job,
} from "@quorem/execution";
import { dockerSandbox } from "../sandbox/docker.ts";
import { executeAndStage, ExecutionYield } from "./execute.ts";
type ExecutionSpec = {
  problemJson: string;
  source: string;
  kind: "run" | "submit";
  cases: readonly string[];
  submitSamples: readonly string[];
  submitCasesAreSamples: boolean;
  privateDetails: boolean;
};
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
    async writeCompletionChunks(_job: Job, items: readonly CompletionFieldChunk[]) {
      for (const item of items) {
        const k = `${item.channel}:${item.ordinal}:${item.field}`,
          v = chunks.get(k) ?? [];
        if (item.chunkOrdinal < v.length) assert.deepEqual(v[item.chunkOrdinal], item.bytes);
        else {
          assert.equal(item.chunkOrdinal, v.length);
          v.push(item.bytes);
        }
        chunks.set(k, v);
      }
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
        cases: Array.from({ length: 9 }, () => item),
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
      const header = await executeAndStage(
        job,
        fixture.port,
        observed,
        undefined,
        undefined,
        undefined,
        4,
      );
      assert.equal(header.publicCount, 9, language);
      assert.deepEqual(
        [...fixture.seals].sort(),
        Array.from({ length: 9 }, (_, index) => `public:${index}:executed`),
        language,
      );
      assert.equal(fixture.frames.length, 9);
      if (!["python", "postgresql"].includes(language))
        assert.deepEqual(
          operations,
          ["compile-execute", ...Array.from({ length: 8 }, () => "execute")],
          `${language} reuses compilation`,
        );
      else
        assert.deepEqual(
          operations,
          Array.from({ length: 9 }, () => "direct"),
        );
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

function fastFixture(overrides: Partial<ExecutionSpec> = {}) {
  const runtime = languageRuntime("python")!;
  const spec: ExecutionSpec = {
    problemJson: JSON.stringify({
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
    }),
    source: "class Solution:\n def f(self): return 7",
    kind: "run",
    cases: Array.from({ length: 20 }, () => '{"args":[],"expected":7}'),
    submitSamples: [],
    submitCasesAreSamples: false,
    privateDetails: false,
    ...overrides,
  };
  const fixture = repository(spec);
  const job: Job = {
    jobId: randomUUID(),
    submissionId: randomUUID(),
    attemptId: randomUUID(),
    sandboxScope: "fixture",
    language: "python",
    problemVersionId: randomUUID(),
    sourceRef: "fixture",
    suiteRef: "fixture",
    runtimeRevision: runtime.revision,
    harnessRevision: runtime.harness,
    limits: defaultLimits(),
  };
  return { fixture, spec, job };
}

void test("Submit overlaps examples and hidden cases without colliding or changing checkpoint order", async () => {
  const { confirmCaseOutput } = await import("../sandbox/proof.ts");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { fixture, spec, job } = fastFixture({
    kind: "submit",
    submitSamples: ['{"args":[],"expected":7}', '{"args":[],"expected":7}'],
  });
  const lanes = new Set<number>();
  const executed = new Set<number>();
  let overlap = false;
  const sandbox = {
    teardownAttempt: async () => {},
    async runCase(request: Parameters<typeof confirmCaseOutput>[0], signal?: AbortSignal) {
      const lane = request.ordinal % CASE_LANES;
      assert.equal(lanes.has(lane), false);
      assert.equal(executed.has(request.ordinal), false);
      executed.add(request.ordinal);
      overlap ||= request.ordinal >= spec.cases.length && lanes.size > 0;
      lanes.add(lane);
      try {
        await delay(request.ordinal === 0 ? 1 : 10, undefined, { signal });
        return confirmCaseOutput(request, {
          stdout: Buffer.from('\0{"status":"executed","actual":7}'),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        });
      } finally {
        lanes.delete(lane);
      }
    },
  };
  await executeAndStage(job, fixture.port, sandbox, undefined, undefined, undefined, 4);
  assert.equal(overlap, true);
  assert.equal(executed.size, 22);
  assert.equal(fixture.frames.length, 22);
  assert.equal(new Set(fixture.seals).size, 22);
  assert.ok(
    fixture.seals.indexOf("sample:0:executed") < fixture.seals.indexOf("private:3:executed"),
  );
});

void test("four native lanes overlap verification while checkpoints remain ordered", async () => {
  const { confirmCaseOutput } = await import("../sandbox/proof.ts");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { fixture, spec, job } = fastFixture();
  let running = 0,
    peak = 0,
    verifying = 0,
    peakVerification = 0,
    overlap = false,
    finalCalls = 0;
  const lanes = new Set<number>();
  const seal = fixture.port.sealCompletionFrame.bind(fixture.port);
  fixture.port.sealCompletionFrame = async (...args) => {
    verifying++;
    peakVerification = Math.max(peakVerification, verifying);
    try {
      await delay(80);
      await seal(...args);
    } finally {
      verifying--;
    }
  };
  const sandbox = {
    teardownAttempt: async () => {},
    async runCase(request: Parameters<typeof confirmCaseOutput>[0], signal?: AbortSignal) {
      const lane = request.ordinal % CASE_LANES;
      assert.equal(lanes.has(lane), false);
      lanes.add(lane);
      running++;
      peak = Math.max(peak, running);
      overlap ||= verifying > 0;
      try {
        await delay(request.ordinal % 4 === 0 ? 30 : 5, undefined, { signal });
        return confirmCaseOutput(request, {
          stdout: Buffer.from('\0{"status":"executed","actual":7}'),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        });
      } finally {
        running--;
        lanes.delete(lane);
      }
    },
  };
  await executeAndStage(
    job,
    fixture.port,
    sandbox,
    undefined,
    undefined,
    () => {
      assert.equal(running, 0);
      finalCalls++;
    },
    4,
  );
  assert.equal(peak, 4);
  assert.equal(overlap, true);
  assert.ok(peakVerification <= 8);
  assert.equal(fixture.frames.length, 20);
  assert.equal(fixture.seals.length, 20);
  assert.equal(finalCalls, 1);
  assert.equal(running, 0);
  assert.equal(verifying, 0);
  const failed = repository(spec);
  failed.port.sealCompletionFrame = async () => {
    throw new Error("verification failed");
  };
  await assert.rejects(
    executeAndStage(job, failed.port, sandbox, undefined, undefined, undefined, 4),
    /verification failed|aborted/,
  );
  assert.equal(running, 0);
  assert.equal(verifying, 0);
  assert.equal(finalCalls, 1);
});

void test(
  "twenty final cases use one fenced input window without retry checkpoints",
  { timeout: 3000 },
  async () => {
    const { confirmCaseOutput } = await import("../sandbox/proof.ts");
    const { fixture, job } = fastFixture();
    const readRef = fixture.port.inputCaseRef.bind(fixture.port);
    const readPage = fixture.port.inputPage.bind(fixture.port);
    let windows = 0,
      entered = 0,
      release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signal = AbortSignal.timeout(1500);
    const expired = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    fixture.port.inputWindow = async (job, start, count) => {
      windows++;
      return Promise.all(
        Array.from({ length: count }, async (_, index) => ({
          ref: await readRef(job, start + index),
          page: await readPage(job, "case", start + index, 0),
        })),
      );
    };
    fixture.port.inputCaseRef = async () => {
      throw new Error("individual reference read");
    };
    fixture.port.inputPage = async (...args) => {
      if (args[1] === "case") throw new Error("individual case page read");
      return readPage(...args);
    };
    fixture.port.finalizeCompletion = async () => {};
    fixture.port.saveCheckpoint = async () => {
      throw new Error("final-window checkpoint");
    };
    const sandbox = {
      async teardownAttempt() {},
      async runCase(request: Parameters<typeof confirmCaseOutput>[0]) {
        if (++entered === 20) release();
        await Promise.race([ready, expired]);
        return confirmCaseOutput(request, {
          stdout: Buffer.from('\0{"status":"executed","actual":7}'),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        });
      },
    };
    await executeAndStage(job, fixture.port, sandbox, signal, undefined, undefined, 20);
    assert.equal(entered, 20);
    assert.equal(windows, 1);
    assert.equal(fixture.seals.length, 20);
    assert.equal(fixture.frames.length, 0);
  },
);

void test(
  "atomic final windows verify a stopped case before the last native case finishes",
  { timeout: 3000 },
  async () => {
    const { confirmCaseOutput } = await import("../sandbox/proof.ts");
    const { fixture, job } = fastFixture();
    fixture.port.finalizeCompletion = async () => {};
    let verified!: () => void;
    const firstVerified = new Promise<void>((resolve) => {
      verified = resolve;
    });
    const seal = fixture.port.sealCompletionFrame.bind(fixture.port);
    let lastRunning = true,
      finalCalls = 0;
    fixture.port.sealCompletionFrame = async (...args) => {
      await seal(...args);
      if (args[2] === 0) {
        assert.equal(lastRunning, true);
        verified();
      }
    };
    const sandbox = {
      async teardownAttempt() {},
      async runCase(request: Parameters<typeof confirmCaseOutput>[0], signal?: AbortSignal) {
        if (request.ordinal === 19) {
          await Promise.race([
            firstVerified,
            new Promise<never>((_, reject) =>
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
            ),
          ]);
          lastRunning = false;
        }
        return confirmCaseOutput(request, {
          stdout: Buffer.from('\0{"status":"executed","actual":7}'),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        });
      },
    };
    await executeAndStage(
      job,
      fixture.port,
      sandbox,
      AbortSignal.timeout(1500),
      undefined,
      () => {
        assert.equal(lastRunning, false);
        finalCalls++;
      },
      20,
    );
    assert.equal(fixture.seals.length, 20);
    assert.equal(fixture.frames.length, 0);
    assert.equal(finalCalls, 1);
  },
);

void test("twenty-case final windows keep at most ten native VMs live without intermediate checkpoints", async () => {
  const { confirmCaseOutput } = await import("../sandbox/proof.ts");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { fixture, job } = fastFixture();
  fixture.port.finalizeCompletion = async () => {};
  fixture.port.saveCheckpoint = async () => {
    throw new Error("final-window checkpoint");
  };
  let active = 0,
    peak = 0,
    calls = 0;
  await executeAndStage(
    job,
    fixture.port,
    {
      async teardownAttempt() {},
      async runCase(request: Parameters<typeof confirmCaseOutput>[0]) {
        calls++;
        active++;
        peak = Math.max(peak, active);
        try {
          await delay(request.ordinal % 2 ? 5 : 15);
          return confirmCaseOutput(request, {
            stdout: Buffer.from('\0{"status":"executed","actual":7}'),
            stderr: Buffer.alloc(0),
            exitCode: 0,
          });
        } finally {
          active--;
        }
      },
    },
    undefined,
    undefined,
    () => {
      assert.equal(active, 0);
    },
    10,
  );
  assert.equal(peak, 10);
  assert.equal(calls, 20);
  assert.equal(fixture.seals.length, 20);
  assert.equal(fixture.frames.length, 0);
});

void test("idle native workers advance the final window while an earlier case remains busy", async () => {
  const { confirmCaseOutput } = await import("../sandbox/proof.ts");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { fixture, job } = fastFixture();
  fixture.port.finalizeCompletion = async () => {};
  let release!: () => void, nextStarted!: () => void;
  const busy = new Promise<void>((resolve) => {
    release = resolve;
  });
  const advanced = new Promise<void>((resolve) => {
    nextStarted = resolve;
  });
  let firstStopped = false,
    active = 0,
    peak = 0;
  const execution = executeAndStage(
    job,
    fixture.port,
    {
      async teardownAttempt() {},
      async runCase(request: Parameters<typeof confirmCaseOutput>[0]) {
        active++;
        peak = Math.max(peak, active);
        try {
          if (request.ordinal === 0) {
            await busy;
            firstStopped = true;
          }
          if (request.ordinal === 10) nextStarted();
          return confirmCaseOutput(request, {
            stdout: Buffer.from('\0{"status":"executed","actual":7}'),
            stderr: Buffer.alloc(0),
            exitCode: 0,
          });
        } finally {
          active--;
        }
      },
    },
    undefined,
    undefined,
    undefined,
    10,
  );
  try {
    await Promise.race([
      advanced,
      delay(1000).then(() => {
        throw new Error("idle worker remained blocked");
      }),
    ]);
    assert.equal(firstStopped, false);
  } finally {
    release();
  }
  await execution;
  assert.ok(peak >= 2 && peak <= 10);
  assert.equal(fixture.seals.length, 20);
  assert.equal(fixture.frames.length, 0);
});

void test("failure in the first native wave prevents queued VM launches", async () => {
  const { confirmCaseOutput } = await import("../sandbox/proof.ts");
  const { fixture, job } = fastFixture();
  fixture.port.finalizeCompletion = async () => {};
  const started: number[] = [];
  await assert.rejects(
    executeAndStage(
      job,
      fixture.port,
      {
        async teardownAttempt() {},
        async runCase(request: Parameters<typeof confirmCaseOutput>[0]) {
          started.push(request.ordinal);
          if (request.ordinal === 0) throw new Error("allocation failed");
          return confirmCaseOutput(request, {
            stdout: Buffer.from('\0{"status":"executed","actual":7}'),
            stderr: Buffer.alloc(0),
            exitCode: 0,
          });
        },
      },
      undefined,
      undefined,
      undefined,
      10,
    ),
    /allocation failed|aborted/,
  );
  assert.ok(started.length <= 10);
  assert.ok(started.every((ordinal) => ordinal < 10));
  assert.equal(fixture.frames.length, 0);
});
