/** @file job.ts @description Validated job wire mapping and scope binding. @module execution */
import { JsonNumber, stringifyLosslessJson, type ExecutionLimits } from "@quorem/questions";
import type { Job } from "./contracts.ts";
import { runtimeForRevision } from "./runtime.ts";
import { decodeObject, intField, stringField } from "./wire.ts";

const limitKeys = [
  "wallTimeMs",
  "memoryBytes",
  "outputBytes",
  "maxProcesses",
  "maxCollectionElements",
  "maxNestingDepth",
] as const;
function checked(job: Job): void {
  for (const [key, value] of Object.entries(job))
    if (key !== "limits" && (typeof value !== "string" || !value))
      throw new Error(`invalid ${key}`);
  if (!/^[A-Za-z0-9-]{1,128}$/.test(job.attemptId) || !job.sandboxScope)
    throw new Error("invalid attempt fence");
  const runtime = runtimeForRevision(job.runtimeRevision, job.harnessRevision);
  if (!runtime || runtime.language !== job.language)
    throw new Error("unsupported runtime revision");
  for (const key of limitKeys)
    if (!Number.isSafeInteger(job.limits[key]) || job.limits[key] < 1)
      throw new Error(`invalid ${key}`);
}
/** Serialize the existing Go job wire format; sandbox scope travels as separate trusted context. */
export function encodeJob(job: Job): string {
  checked(job);
  const limits = Object.fromEntries(
    limitKeys.map((key) => [key, new JsonNumber(String(job.limits[key]))]),
  );
  return stringifyLosslessJson({
    language: job.language,
    jobId: job.jobId,
    submissionId: job.submissionId,
    attemptId: job.attemptId,
    problemVersionId: job.problemVersionId,
    runtimeRevision: job.runtimeRevision,
    harnessRevision: job.harnessRevision,
    sourceRef: job.sourceRef,
    suiteRef: job.suiteRef,
    limits,
  });
}
/** Decode a job and bind it to the separately supplied trusted sandbox scope. */
export function decodeJob(json: string, sandboxScope: string): Job {
  const obj = decodeObject(json);
  const rawLimits = obj.limits;
  if (
    !rawLimits ||
    typeof rawLimits !== "object" ||
    rawLimits instanceof JsonNumber ||
    Array.isArray(rawLimits)
  )
    throw new Error("invalid limits");
  const limits = Object.fromEntries(
    limitKeys.map((key) => [
      key,
      Number(intField(rawLimits, key, 1n, BigInt(Number.MAX_SAFE_INTEGER))),
    ]),
  ) as unknown as ExecutionLimits;
  const job: Job = {
    language: stringField(obj, "language"),
    jobId: stringField(obj, "jobId"),
    submissionId: stringField(obj, "submissionId"),
    attemptId: stringField(obj, "attemptId"),
    problemVersionId: stringField(obj, "problemVersionId"),
    runtimeRevision: stringField(obj, "runtimeRevision"),
    harnessRevision: stringField(obj, "harnessRevision"),
    sourceRef: stringField(obj, "sourceRef"),
    suiteRef: stringField(obj, "suiteRef"),
    sandboxScope,
    limits,
  };
  checked(job);
  return job;
}
