import { expect, it } from "vitest";
import vectors from "../../../fixtures/migration/private/frame-oracle.json";
import oracle from "../../../fixtures/migration/private/go-oracle.json";
import {
  assertAttemptFence,
  assertClaimFence,
  validateCompiledArtifact,
  assertCompletion,
  compressCheckpointFrame,
  decompressCheckpointFrame,
  encodeJudgeFrame,
  decodeJudgeFrame,
  encodeCheckpoint,
  decodeCheckpoint,
  decodeCaseFrames,
  decodeCheckpointCase,
  decodeCompletion,
  decodeJob,
  encodeCheckpointCase,
  checkpointProvenance,
  encodeCheckpointFrame,
  decodeCheckpointFrame,
  assertCheckpointProvenance,
  encodeCompletion,
  encodeJob,
  languageRuntime,
  runtimeForRevision,
  sourceHash,
  type Job,
} from "../src/index.ts";

const job: Job = {
  language: "python",
  jobId: "job",
  submissionId: "submission",
  attemptId: "attempt-1",
  sandboxScope: "sandbox-a",
  problemVersionId: "problem",
  runtimeRevision: "python-3.12-v1",
  harnessRevision: "quorem-harness-v2",
  sourceRef: "source",
  suiteRef: "suite",
  limits: {
    wallTimeMs: 2000,
    memoryBytes: 268435456,
    outputBytes: 65536,
    maxProcesses: 16,
    maxCollectionElements: 10000,
    maxNestingDepth: 100,
  },
};
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (v) => parseInt(v, 16));
async function* chunks(data: Uint8Array) {
  for (const byte of data) yield new Uint8Array([byte]);
}

it("binds exact attempt and sandbox scope and rejects stale runtime pairs", () => {
  expect(decodeJob(encodeJob(job), job.sandboxScope)).toEqual(job);
  expect(encodeJob(job)).not.toContain("sandboxScope");
  expect(() =>
    assertAttemptFence(job, { attemptId: job.attemptId, sandboxScope: "other" }),
  ).toThrow();
  expect(() =>
    assertAttemptFence(job, { attemptId: "old", sandboxScope: job.sandboxScope }),
  ).toThrow();
  expect(() => decodeJob(encodeJob(job), "")).toThrow();
  expect(() => encodeJob({ ...job, harnessRevision: "old" })).toThrow();
  expect(runtimeForRevision("postgresql-17.6-v1", "quorem-postgresql-v1")?.language).toBe(
    "postgresql",
  );
  expect(languageRuntime("postgresql")?.harness).toBe("quorem-postgresql-v2");
});
it("matches stored Go runtime registry vectors", () => {
  for (const v of oracle.filter((item) => item.name === "runtime")) {
    const output = v.output as {
      found: boolean;
      runtime: { Language: string; Revision: string; Harness: string; Image: string };
    };
    const got = languageRuntime(v.input as string);
    if (!output.found) expect(got).toBeUndefined();
    else
      expect(got).toEqual({
        language: output.runtime.Language,
        revision: output.runtime.Revision,
        harness: output.runtime.Harness,
        image: output.runtime.Image,
      });
  }
});
it("preserves bound checkpoint JSON and rejects legacy frames", async () => {
  const spec = {
    problemJson: '{"signature":{}}',
    source: "fixture",
    kind: "run" as const,
    cases: ["{}", "{}", '{"args":[9007199254740993]}'],
    submitSamples: [],
    submitCasesAreSamples: false,
    privateDetails: false,
  };
  const frame = {
    status: "executed",
    actual: "9007199254740993",
    stdout: "a\u0000b",
    stderr: "",
    line: 0,
  };
  const metadata = {
    artifact: '{"file":"AA=="}',
    compilationNanos: 123456789n,
    fatal: '{"status":"syntax_error"}',
  };
  const provenance = await checkpointProvenance(job, spec, 2, job, metadata, frame);
  const cp = {
    ordinal: 2,
    frame: encodeCheckpointFrame(frame, provenance),
    ...metadata,
  };
  expect(decodeCheckpointCase(encodeCheckpointCase(cp))).toEqual(cp);
  expect(() => encodeCheckpointCase({ ...cp, ordinal: 320 })).toThrow();
  expect(() => encodeCheckpointCase({ ...cp, compilationNanos: 120000000001n })).toThrow();
  expect(() => decodeCheckpointCase('{"Ordinal":0,"Frame":{},"CompilationNanos":1.0}')).toThrow();
  const go = oracle.find((v) => v.name === "checkpointCaseJSON")!;
  expect(() => decodeCheckpointCase(go.output as string)).toThrow();
  const decoded = decodeCheckpointFrame(cp.frame);
  await assertCheckpointProvenance(job, spec, 2, decoded.provenance, true, decoded.frame, metadata);
  const resumed = { ...job, attemptId: "attempt-2" };
  await assertCheckpointProvenance(
    resumed,
    spec,
    2,
    decoded.provenance,
    false,
    decoded.frame,
    metadata,
  );
  await expect(
    assertCheckpointProvenance(resumed, spec, 2, decoded.provenance, true, decoded.frame, metadata),
  ).rejects.toThrow();
  for (const changed of [
    { ...spec, source: "different" },
    { ...spec, problemJson: '{"signature":{"x":1}}' },
    { ...spec, cases: ["{}", "{}", '{"args":[9007199254740992]}'] },
  ])
    await expect(
      assertCheckpointProvenance(
        job,
        changed,
        2,
        decoded.provenance,
        false,
        decoded.frame,
        metadata,
      ),
    ).rejects.toThrow();
  await expect(
    assertCheckpointProvenance(
      { ...job, sandboxScope: "other" },
      spec,
      2,
      decoded.provenance,
      false,
      decoded.frame,
      metadata,
    ),
  ).rejects.toThrow();
  await expect(
    assertCheckpointProvenance(
      { ...job, runtimeRevision: "different" },
      spec,
      2,
      decoded.provenance,
      false,
      decoded.frame,
      metadata,
    ),
  ).rejects.toThrow();
  await expect(
    assertCheckpointProvenance(
      job,
      spec,
      2,
      decoded.provenance,
      false,
      { ...decoded.frame, actual: "0" },
      metadata,
    ),
  ).rejects.toThrow();
  await expect(
    assertCheckpointProvenance(job, spec, 2, decoded.provenance, false, decoded.frame, {
      ...metadata,
      artifact: '{"file":"AQ=="}',
    }),
  ).rejects.toThrow();
});
it("maps completion raw values without leaking hidden fields", () => {
  const value = {
    submissionId: "s",
    attemptId: "a",
    publicCaseResults: [
      { index: 0, status: "accepted", actual: "9007199254740993", expected: '{"s":"\\u0000"}' },
    ],
    hiddenCases: [{ index: 1, status: "accepted" as const }],
  };
  expect(decodeCompletion(encodeCompletion(value)).publicCaseResults?.[0].actual).toBe(
    "9007199254740993",
  );
  expect(() =>
    decodeCompletion(
      '{"submissionId":"s","attemptId":"a","hiddenCases":[{"index":0,"status":"accepted","actual":1}]}',
    ),
  ).toThrow();
});
it("hashes exact valid UTF-8 source", async () => {
  expect(await sourceHash("a😀b")).toBe(
    "6fba5b2ea783ded096fc2444d540ffbdf49168df30993b155b7efb683313f110",
  );
  await expect(sourceHash("x\0y")).rejects.toThrow();
});
it("decodes Go binary frame vectors with fragmented chunks", async () => {
  for (const v of vectors) {
    const stdout: number[] = [],
      stderr: number[] = [];
    const run = () =>
      decodeCaseFrames(
        chunks(bytes(v.inputHex)),
        { stdoutBytes: 65536, stderrBytes: 65536 },
        async (channel, data) => {
          (channel === "stdout" ? stdout : stderr).push(...data);
        },
      );
    if ("error" in v) await expect(run(), v.name).rejects.toThrow();
    else {
      expect(await run(), v.name).toBe(v.exitCode);
      expect(Uint8Array.from(stdout)).toEqual(bytes(v.stdoutHex));
      expect(Uint8Array.from(stderr)).toEqual(bytes(v.stderrHex));
    }
  }
});
it("enforces output limits and backpressure", async () => {
  const frame = bytes(vectors[0].inputHex);
  await expect(
    decodeCaseFrames(chunks(frame), { stdoutBytes: 2, stderrBytes: 3 }, async () => {}),
  ).rejects.toThrow("limit");
  let writes = 0;
  expect(
    await decodeCaseFrames(chunks(frame), { stdoutBytes: 3, stderrBytes: 3 }, async () => {
      await Promise.resolve();
      writes++;
    }),
  ).toBe(7);
  expect(writes).toBe(2);
});

it("round-trips metadata and private judge frames", () => {
  const frame = {
    status: "executed",
    actual: '{"n":9007199254740993}',
    artifact: '{"binary":"AA=="}',
    stdout: "\0",
    stderr: "",
    line: 0,
    sqlTypes: ["bigint"],
  };
  expect(decodeJudgeFrame(encodeJudgeFrame(frame))).toEqual(frame);
  const cp = {
    nextOrdinal: 320,
    artifact: '{"binary":"AA=="}',
    compilationNanos: 120000000000n,
    fatal: undefined,
  };
  expect(decodeCheckpoint(encodeCheckpoint(cp))).toEqual(cp);
  expect(() =>
    assertCompletion(job, { submissionId: job.submissionId, attemptId: "old" }),
  ).toThrow();
  expect(() =>
    assertCompletion(job, { submissionId: "other", attemptId: job.attemptId }),
  ).toThrow();
});

it("round-trips bounded compressed private frames", async () => {
  const input = new TextEncoder().encode('{"actual":9007199254740993,"stdout":"a\\u0000b"}');
  const goGzip = bytes(
    "1f8b08000000000004ff002f00d0ff7b22737461747573223a226578656375746564222c2261637475616c223a393030373139393235343734303939337d03004bea4ee12f000000",
  );
  expect(new TextDecoder().decode(await decompressCheckpointFrame(goGzip))).toBe(
    '{"status":"executed","actual":9007199254740993}',
  );
  const compressed = await compressCheckpointFrame(input);
  expect(await decompressCheckpointFrame(compressed)).toEqual(input);
  await expect(decompressCheckpointFrame(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  await expect(compressCheckpointFrame(new Uint8Array((2 << 20) + 1))).rejects.toThrow();
});
it("waits for output consumers and rejects aborted input", async () => {
  const all = bytes(vectors[0].inputHex);
  let pulls = 0;
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  async function* input() {
    pulls++;
    yield all.subarray(0, 11);
    pulls++;
    yield all.subarray(11);
  }
  const pending = decodeCaseFrames(input(), { stdoutBytes: 3, stderrBytes: 3 }, async (channel) => {
    if (channel === "stdout") {
      entered();
      await blocked;
    }
  });
  await started;
  expect(pulls).toBe(1);
  release();
  expect(await pending).toBe(7);
  expect(pulls).toBe(2);
  const controller = new AbortController();
  controller.abort();
  await expect(
    decodeCaseFrames(
      input(),
      { stdoutBytes: 3, stderrBytes: 3 },
      async () => {},
      controller.signal,
    ),
  ).rejects.toThrow("aborted");
});

it("validates compiled artifact paths, entrypoints and strict base64", () => {
  expect(() =>
    validateCompiledArtifact(
      '{"version":1,"language":"java","files":{"Main.class":"AA=="}}',
      "java",
    ),
  ).not.toThrow();
  for (const raw of [
    '{"version":1,"language":"java","files":{"Main.class":"AB=="}}',
    '{"version":1,"language":"java","files":{"../Main.class":"AA==","Main.class":"AA=="}}',
    '{"version":1,"language":"java","files":{"other.class":"AA=="}}',
  ])
    expect(() => validateCompiledArtifact(raw, "java")).toThrow();
  expect(() =>
    assertClaimFence("scope-a", { attemptId: "old", sandboxScope: "scope-b" }),
  ).toThrow();
  expect(() =>
    assertClaimFence("scope-a", { attemptId: "old", sandboxScope: "scope-a" }),
  ).not.toThrow();
});
