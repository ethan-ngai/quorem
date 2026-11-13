/** @file manifest-binding.ts @description Immutable manifest case identity for runner provenance. @module execution */
import type { AttemptFence, InputCaseRef, InputManifest, Job } from "./contracts.ts";
import { encodeJob } from "./job.ts";
import { decodeInputManifest, decodeInputCaseRef } from "./input-contract.ts";
const hex = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Hash only immutable fixed-size references; callers fetch the case separately by ordinal. */
export async function manifestCaseBinding(
  job: Job,
  manifest: InputManifest,
  ref: InputCaseRef,
  ordinal: number,
  original: AttemptFence,
): Promise<string> {
  encodeJob(job);
  decodeInputManifest(manifest);
  decodeInputCaseRef(ref);
  const total = manifest.caseCount + (manifest.submitCasesAreSamples ? 0 : manifest.sampleCount);
  const expected =
    manifest.kind === "run" || manifest.submitCasesAreSamples
      ? "public"
      : ordinal < manifest.caseCount
        ? "private"
        : "sample";
  if (
    [
      job.jobId,
      job.submissionId,
      job.problemVersionId,
      job.sourceRef,
      job.suiteRef,
      job.language,
      job.runtimeRevision,
      job.harnessRevision,
    ].some((value) => !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= total ||
    ref.channel !== expected ||
    !/^[A-Za-z0-9-]{1,128}$/.test(original.attemptId) ||
    original.sandboxScope !== job.sandboxScope ||
    !original.sandboxScope ||
    enc.encode(original.sandboxScope).length > 256 ||
    Array.from(original.sandboxScope).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid manifest case");
  return digest(
    JSON.stringify([
      "quorem-manifest-case-v1",
      job.jobId,
      job.submissionId,
      job.problemVersionId,
      job.sourceRef,
      job.suiteRef,
      job.language,
      job.runtimeRevision,
      job.harnessRevision,
      [
        job.limits.wallTimeMs,
        job.limits.memoryBytes,
        job.limits.outputBytes,
        job.limits.maxProcesses,
        job.limits.maxCollectionElements,
        job.limits.maxNestingDepth,
      ],
      manifest.kind,
      manifest.level,
      manifest.caseCount,
      manifest.sampleCount,
      manifest.privateDetails,
      manifest.submitCasesAreSamples,
      manifest.source.hash,
      manifest.source.size,
      manifest.metadata.hash,
      manifest.metadata.size,
      manifest.suiteHash,
      ordinal,
      ref.channel,
      ref.hash,
      ref.size,
      original.attemptId,
      original.sandboxScope,
      ...(job.automaticImports === undefined ? [] : [job.automaticImports]),
    ]),
  );
}
/** Bind actual request bytes without materializing their contents. */
export async function manifestInvocationBinding(
  job: Job,
  manifest: InputManifest,
  ref: InputCaseRef,
  ordinal: number,
  original: AttemptFence,
  requestHash: string,
  limits: Job["limits"] = job.limits,
): Promise<string> {
  if (!hex.test(requestHash)) throw new Error("Invalid invocation hash");
  return digest(
    JSON.stringify([
      "quorem-manifest-invocation-v1",
      await manifestCaseBinding(job, manifest, ref, ordinal, original),
      requestHash,
      ...(limits === job.limits ? [] : [limits.wallTimeMs, limits.memoryBytes]),
    ]),
  );
}
