/** @file input-contract.ts @description Decode untrusted execution input references. @module execution */
import type { InputBlobRef, InputCaseRef, InputManifest } from "./contracts.ts";

const hex = /^[0-9a-f]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function decodeInputBlob(value: unknown): InputBlobRef {
  if (
    !object(value) ||
    typeof value.hash !== "string" ||
    !hex.test(value.hash) ||
    !nonnegativeInteger(value.size) ||
    value.size > 1073741823
  )
    throw new Error("Invalid input blob");
  return { hash: value.hash, size: value.size };
}

export function decodeInputCaseRef(value: unknown): InputCaseRef {
  const blob = decodeInputBlob(value);
  if (
    !object(value) ||
    (value.channel !== "public" && value.channel !== "sample" && value.channel !== "private")
  )
    throw new Error("Invalid input case reference");
  return { ...blob, channel: value.channel };
}

export function decodeInputManifest(value: unknown): InputManifest {
  if (
    !object(value) ||
    (value.kind !== "run" && value.kind !== "submit") ||
    (value.level !== null && (!nonnegativeInteger(value.level) || value.level < 1)) ||
    !nonnegativeInteger(value.caseCount) ||
    !nonnegativeInteger(value.sampleCount) ||
    typeof value.privateDetails !== "boolean" ||
    typeof value.submitCasesAreSamples !== "boolean" ||
    (value.submitCasesAreSamples &&
      (value.kind !== "submit" ||
        !value.privateDetails ||
        value.caseCount !== value.sampleCount)) ||
    (value.kind === "run" && value.sampleCount !== 0) ||
    value.caseCount + (value.submitCasesAreSamples ? 0 : value.sampleCount) > 2147483647 ||
    typeof value.suiteHash !== "string" ||
    !hex.test(value.suiteHash)
  )
    throw new Error("Invalid input manifest");
  return {
    kind: value.kind,
    level: value.level,
    caseCount: value.caseCount,
    sampleCount: value.sampleCount,
    privateDetails: value.privateDetails,
    submitCasesAreSamples: value.submitCasesAreSamples,
    suiteHash: value.suiteHash,
    source: decodeInputBlob(value.source),
    metadata: decodeInputBlob(value.metadata),
  };
}
