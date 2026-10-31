/** @file manifest-checkpoint.ts @description Manifest-bound checkpoint envelopes. @module execution */
import { parseLosslessJson, stringifyLosslessJson } from "@quorem/questions";
import type { AttemptFence, Checkpoint, InputCaseRef, InputManifest, Job } from "./contracts.ts";
import { decodeJudgeFrame, encodeJudgeFrame, type JudgeFrame } from "./judge-frame.ts";
import { decodeObject, intField, rawFields, stringField } from "./wire.ts";
import { manifestCaseBinding } from "./manifest-binding.ts";
import { checkpointFrameHash, checkpointMetadataHash } from "./checkpoint-provenance.ts";

export interface ManifestCheckpointProvenance {
  readonly schemaVersion: 2;
  readonly ordinal: number;
  readonly attemptId: string;
  readonly sandboxScope: string;
  readonly caseBinding: string;
  readonly frameHash: string;
  readonly artifactHash: string;
  readonly fatalHash: string;
  readonly compilationNanos: string;
  readonly binding: string;
}
const enc = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function seal(p: Omit<ManifestCheckpointProvenance, "binding">): Promise<string> {
  return digest(
    JSON.stringify([
      "quorem-manifest-checkpoint-v2",
      p.caseBinding,
      p.frameHash,
      p.artifactHash,
      p.fatalHash,
      p.compilationNanos,
    ]),
  );
}
/** Provenance binds the frame and checkpoint metadata to one immutable manifest case. */
export async function manifestCheckpointProvenance(
  job: Job,
  manifest: InputManifest,
  ref: InputCaseRef,
  ordinal: number,
  original: AttemptFence,
  metadata: Pick<Checkpoint, "artifact" | "fatal" | "compilationNanos">,
  frame: JudgeFrame,
): Promise<ManifestCheckpointProvenance> {
  if (metadata.compilationNanos < 0n || metadata.compilationNanos > 120000000000n)
    throw new Error("Invalid checkpoint metadata");
  const [caseBinding, frameHash, artifactHash, fatalHash] = await Promise.all([
    manifestCaseBinding(job, manifest, ref, ordinal, original),
    checkpointFrameHash(frame),
    checkpointMetadataHash(metadata.artifact),
    checkpointMetadataHash(metadata.fatal),
  ]);
  const value = {
    schemaVersion: 2,
    ordinal,
    attemptId: original.attemptId,
    sandboxScope: original.sandboxScope,
    caseBinding,
    frameHash,
    artifactHash,
    fatalHash,
    compilationNanos: metadata.compilationNanos.toString(),
  } as const;
  return { ...value, binding: await seal(value) };
}
export function encodeManifestCheckpointFrame(
  frame: JudgeFrame,
  provenance: ManifestCheckpointProvenance,
): string {
  const encoded = JSON.stringify(provenance);
  parseLosslessJson(encoded);
  return `{"provenance":${encoded},"frame":${encodeJudgeFrame(frame)}}`;
}
/** Unbound and old-version frames deliberately fail closed. */
export function decodeManifestCheckpointFrame(raw: string): {
  frame: JudgeFrame;
  provenance: ManifestCheckpointProvenance;
} {
  const root = decodeObject(raw),
    fields = rawFields(raw),
    value = root.provenance;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !fields.has("frame") ||
    Object.keys(root).some((key) => key !== "provenance" && key !== "frame")
  )
    throw new Error("Invalid checkpoint envelope");
  const rawProvenance = fields.get("provenance");
  if (!rawProvenance) throw new Error("Invalid checkpoint envelope");
  rawFields(rawProvenance);
  rawFields(fields.get("frame")!);
  const p = decodeObject(stringifyLosslessJson(value));
  if (
    Object.keys(p).some(
      (key) =>
        ![
          "schemaVersion",
          "ordinal",
          "attemptId",
          "sandboxScope",
          "caseBinding",
          "frameHash",
          "artifactHash",
          "fatalHash",
          "compilationNanos",
          "binding",
        ].includes(key),
    )
  )
    throw new Error("Invalid checkpoint envelope");
  const schemaVersion = Number(intField(p, "schemaVersion", 2n, 2n)) as 2,
    ordinal = Number(intField(p, "ordinal", 0n, 319n));
  const attemptId = stringField(p, "attemptId"),
    sandboxScope = stringField(p, "sandboxScope"),
    caseBinding = stringField(p, "caseBinding"),
    frameHash = stringField(p, "frameHash"),
    artifactHash = stringField(p, "artifactHash"),
    fatalHash = stringField(p, "fatalHash"),
    compilationNanos = stringField(p, "compilationNanos"),
    binding = stringField(p, "binding");
  if (
    ![caseBinding, frameHash, artifactHash, fatalHash, binding].every((v) => hashPattern.test(v)) ||
    !/^[A-Za-z0-9-]{1,128}$/.test(attemptId) ||
    !sandboxScope ||
    enc.encode(sandboxScope).length > 256 ||
    Array.from(sandboxScope).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    !/^(0|[1-9][0-9]*)$/.test(compilationNanos) ||
    BigInt(compilationNanos) > 120000000000n
  )
    throw new Error("Invalid checkpoint envelope");
  const frameObject = decodeObject(fields.get("frame")!);
  if (
    Object.keys(frameObject).some(
      (key) =>
        !["status", "sqlTypes", "artifact", "actual", "stdout", "stderr", "line"].includes(key),
    )
  )
    throw new Error("Invalid checkpoint frame");
  return {
    frame: decodeJudgeFrame(fields.get("frame")!),
    provenance: {
      schemaVersion,
      ordinal,
      attemptId,
      sandboxScope,
      caseBinding,
      frameHash,
      artifactHash,
      fatalHash,
      compilationNanos,
      binding,
    },
  };
}
/** Replays retain the original attempt but must retain the current exact sandbox scope. */
export async function assertManifestCheckpoint(
  job: Job,
  manifest: InputManifest,
  ref: InputCaseRef,
  ordinal: number,
  actual: ManifestCheckpointProvenance,
  writing: boolean,
  frame: JudgeFrame,
  metadata?: Pick<Checkpoint, "artifact" | "fatal" | "compilationNanos">,
): Promise<void> {
  if (
    actual.schemaVersion !== 2 ||
    ![
      actual.caseBinding,
      actual.frameHash,
      actual.artifactHash,
      actual.fatalHash,
      actual.binding,
    ].every((value) => hashPattern.test(value)) ||
    !/^(0|[1-9][0-9]*)$/.test(actual.compilationNanos) ||
    BigInt(actual.compilationNanos) > 120000000000n ||
    (metadata !== undefined &&
      (metadata.compilationNanos < 0n || metadata.compilationNanos > 120000000000n)) ||
    actual.ordinal !== ordinal ||
    actual.sandboxScope !== job.sandboxScope ||
    (writing && actual.attemptId !== job.attemptId)
  )
    throw new Error("Checkpoint fence mismatch");
  const caseBinding = await manifestCaseBinding(job, manifest, ref, ordinal, {
    attemptId: actual.attemptId,
    sandboxScope: actual.sandboxScope,
  });
  const frameHash = await checkpointFrameHash(frame);
  const artifactHash = metadata
    ? await checkpointMetadataHash(metadata.artifact)
    : actual.artifactHash;
  const fatalHash = metadata ? await checkpointMetadataHash(metadata.fatal) : actual.fatalHash;
  const compilationNanos = metadata
    ? metadata.compilationNanos.toString()
    : actual.compilationNanos;
  const expected = { ...actual, caseBinding, frameHash, artifactHash, fatalHash, compilationNanos };
  if (
    caseBinding !== actual.caseBinding ||
    frameHash !== actual.frameHash ||
    artifactHash !== actual.artifactHash ||
    fatalHash !== actual.fatalHash ||
    compilationNanos !== actual.compilationNanos ||
    (await seal(expected)) !== actual.binding
  )
    throw new Error("Checkpoint provenance mismatch");
}
