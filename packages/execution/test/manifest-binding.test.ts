import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  manifestCaseBinding,
  manifestInvocationBinding,
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
  sampleCount: 1,
  privateDetails: false,
  submitCasesAreSamples: false,
  source: { hash: "a".repeat(64), size: 10 },
  metadata: { hash: "b".repeat(64), size: 20 },
  suiteHash: "c".repeat(64),
};
const ref: InputCaseRef = { hash: "d".repeat(64), size: 30, channel: "private" };
describe("manifest provenance identity", () => {
  it("binds source, metadata, suite, ordinal, visibility, job and original attempt", async () => {
    const initial = await manifestCaseBinding(job, manifest, ref, 0, job);
    for (const changed of [
      { ...manifest, source: { ...manifest.source, hash: "1".repeat(64) } },
      { ...manifest, metadata: { ...manifest.metadata, size: 21 } },
      { ...manifest, suiteHash: "2".repeat(64) },
      { ...manifest, level: 1 },
    ])
      expect(await manifestCaseBinding(job, changed, ref, 0, job)).not.toBe(initial);
    expect(
      await manifestCaseBinding(job, manifest, { ...ref, hash: "3".repeat(64) }, 0, job),
    ).not.toBe(initial);
    expect(
      await manifestCaseBinding(job, manifest, ref, 0, { ...job, attemptId: "previous" }),
    ).not.toBe(initial);
    await expect(
      manifestCaseBinding(job, manifest, ref, 0, { ...job, sandboxScope: "other" }),
    ).rejects.toThrow();
    await expect(
      manifestCaseBinding(job, manifest, { ...ref, channel: "public" }, 0, job),
    ).rejects.toThrow();
    expect(
      await manifestCaseBinding(job, manifest, { ...ref, channel: "sample" }, 1, job),
    ).not.toBe(initial);
  });
  it("binds the request digest and allows the explicit interview sample fallback only", async () => {
    const a = await manifestInvocationBinding(job, manifest, ref, 0, job, "e".repeat(64));
    expect(await manifestInvocationBinding(job, manifest, ref, 0, job, "f".repeat(64))).not.toBe(a);
    const fallback: InputManifest = {
      ...manifest,
      privateDetails: true,
      submitCasesAreSamples: true,
    };
    await expect(
      manifestCaseBinding(job, fallback, { ...ref, channel: "public" }, 0, job),
    ).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(
      manifestCaseBinding(
        job,
        { ...fallback, privateDetails: false },
        { ...ref, channel: "public" },
        0,
        job,
      ),
    ).rejects.toThrow();
  });
});
