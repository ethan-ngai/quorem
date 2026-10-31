import { describe, expect, it } from "vitest";
import {
  assertManifestCheckpoint,
  decodeManifestCheckpointFrame,
  encodeManifestCheckpointFrame,
  manifestCheckpointProvenance,
  decodeJudgeFrame,
  defaultLimits,
  type InputCaseRef,
  type InputManifest,
  type Job,
} from "../src/index.ts";
const job: Job = {
  jobId: "job",
  submissionId: "submission",
  problemVersionId: "problem",
  sourceRef: "source",
  suiteRef: "suite",
  language: "python",
  runtimeRevision: "python-3.12-v1",
  harnessRevision: "quorem-harness-v2",
  attemptId: "attempt",
  sandboxScope: "scope",
  limits: defaultLimits(),
};
const manifest: InputManifest = {
  kind: "submit",
  level: null,
  caseCount: 1,
  sampleCount: 0,
  privateDetails: false,
  submitCasesAreSamples: false,
  source: { hash: "a".repeat(64), size: 10 },
  metadata: { hash: "b".repeat(64), size: 20 },
  suiteHash: "c".repeat(64),
};
const ref: InputCaseRef = { hash: "d".repeat(64), size: 30, channel: "private" };
const frame = decodeJudgeFrame(
  '{"status":"executed","actual":9007199254740993,"stdout":"a\\u0000b","stderr":"","line":0}',
);
const metadata = { artifact: '{"b":2,"a":1}', compilationNanos: 42n };
describe("manifest checkpoint provenance", () => {
  it("binds frame, metadata and original attempt and permits only same-scope replay", async () => {
    const provenance = await manifestCheckpointProvenance(
      job,
      manifest,
      ref,
      0,
      job,
      metadata,
      frame,
    );
    const raw = encodeManifestCheckpointFrame(frame, provenance),
      decoded = decodeManifestCheckpointFrame(raw);
    await expect(
      assertManifestCheckpoint(
        job,
        manifest,
        ref,
        0,
        decoded.provenance,
        true,
        decoded.frame,
        metadata,
      ),
    ).resolves.toBeUndefined();
    const next = { ...job, attemptId: "next" };
    await expect(
      assertManifestCheckpoint(
        next,
        manifest,
        ref,
        0,
        decoded.provenance,
        false,
        decoded.frame,
        metadata,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertManifestCheckpoint(
        next,
        manifest,
        ref,
        0,
        decoded.provenance,
        true,
        decoded.frame,
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(
        { ...next, sandboxScope: "other" },
        manifest,
        ref,
        0,
        decoded.provenance,
        false,
        decoded.frame,
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(
        job,
        { ...manifest, suiteHash: "e".repeat(64) },
        ref,
        0,
        decoded.provenance,
        true,
        decoded.frame,
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(
        job,
        manifest,
        { ...ref, hash: "e".repeat(64) },
        0,
        decoded.provenance,
        true,
        decoded.frame,
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(job, manifest, ref, 0, decoded.provenance, true, decoded.frame, {
        ...metadata,
        compilationNanos: 43n,
      }),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(
        job,
        manifest,
        ref,
        0,
        decoded.provenance,
        true,
        { ...decoded.frame, actual: "1" },
        metadata,
      ),
    ).rejects.toThrow();
    await expect(
      assertManifestCheckpoint(job, manifest, ref, 0, decoded.provenance, true, decoded.frame, {
        ...metadata,
        artifact: '{"a":1,"b":2}',
      }),
    ).resolves.toBeUndefined();
  });
  it("rejects old, malformed and duplicate envelope fields", async () => {
    const p = await manifestCheckpointProvenance(job, manifest, ref, 0, job, metadata, frame),
      raw = encodeManifestCheckpointFrame(frame, p);
    expect(() => decodeManifestCheckpointFrame('{"status":"executed"}')).toThrow();
    expect(() =>
      decodeManifestCheckpointFrame(raw.replace('"schemaVersion":2', '"schemaVersion":1')),
    ).toThrow();
    expect(() =>
      decodeManifestCheckpointFrame(raw.replace('"ordinal":0', '"ordinal":0,"ordinal":0')),
    ).toThrow();
    expect(() =>
      decodeManifestCheckpointFrame(raw.replace('"frame":{', '"frame":{"line":0,')),
    ).toThrow();
  });
});
