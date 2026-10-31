/** @file checkpoint-provenance.ts @description Versioned immutable checkpoint case binding. @module execution */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import type { AttemptFence, Checkpoint, ExecutionSpec, Job } from "./contracts.ts";
import { decodeJudgeFrame, encodeJudgeFrame, type JudgeFrame } from "./judge-frame.ts";
import { decodeObject, intField, rawFields, stringField } from "./wire.ts";
import { sourceHash as hashSource } from "./source.ts";

export interface CheckpointProvenance {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly submissionId: string;
  readonly problemVersionId: string;
  readonly sourceRef: string;
  readonly suiteRef: string;
  readonly language: string;
  readonly runtimeRevision: string;
  readonly harnessRevision: string;
  readonly ordinal: number;
  readonly attemptId: string;
  readonly sandboxScope: string;
  readonly sourceHash: string;
  readonly problemHash: string;
  readonly caseHash: string;
  readonly suiteHash: string;
  readonly frameHash: string;
  readonly artifactHash: string;
  readonly fatalHash: string;
  readonly compilationNanos: string;
  readonly binding: string;
}
const encoder = new TextEncoder();
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashBytes(value: Uint8Array): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new Uint8Array(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Binds one sandbox invocation to the immutable admitted case and exact request bytes. */
export async function caseInvocationBinding(
  job: Job,
  spec: ExecutionSpec,
  ordinal: number,
  input: Uint8Array,
): Promise<string> {
  const frame: JudgeFrame = { status: "executed", actual: "null", stdout: "", stderr: "", line: 0 };
  const provenance = await checkpointProvenance(
    job,
    spec,
    ordinal,
    job,
    { compilationNanos: 0n },
    frame,
  );
  return hash(
    JSON.stringify(["quorem-case-invocation-v1", provenance.binding, await hashBytes(input)]),
  );
}
function canonicalMetadata(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === "object" && !(value instanceof JsonNumber))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalMetadata(value[key])]),
    );
  return value;
}
/** Hash bounded checkpoint metadata after stable key ordering, independent of JSONB rendering. */
export async function checkpointMetadataHash(value: string | undefined): Promise<string> {
  return hash(
    value === undefined ? "" : stringifyLosslessJson(canonicalMetadata(parseLosslessJson(value))),
  );
}
/** Hash the validated bounded frame using the canonical wire encoder. */
export async function checkpointFrameHash(frame: JudgeFrame): Promise<string> {
  return hash(encodeJudgeFrame(frame));
}
async function bindingFor(
  job: Job,
  spec: ExecutionSpec,
  p: Omit<CheckpointProvenance, "binding">,
): Promise<string> {
  return hash(
    JSON.stringify([
      "quorem-checkpoint-v1",
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
      spec.kind,
      p.ordinal,
      p.attemptId,
      p.sandboxScope,
      p.sourceHash,
      p.problemHash,
      p.caseHash,
      p.suiteHash,
      p.frameHash,
      p.artifactHash,
      p.fatalHash,
      p.compilationNanos,
    ]),
  );
}
/** Inputs retain their admitted raw numeric lexemes; fixed ordered fields bind the case to its job. */
export async function checkpointProvenance(
  job: Job,
  spec: ExecutionSpec,
  ordinal: number,
  original: AttemptFence,
  metadata: Pick<Checkpoint, "artifact" | "fatal" | "compilationNanos">,
  frame: JudgeFrame,
): Promise<CheckpointProvenance> {
  const cases =
    spec.kind === "submit" && !spec.submitCasesAreSamples
      ? [...spec.cases, ...spec.submitSamples]
      : spec.cases;
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
    ordinal >= cases.length ||
    ordinal > 2147483646 ||
    !/^[A-Za-z0-9-]{1,128}$/.test(original.attemptId) ||
    !original.sandboxScope ||
    encoder.encode(original.sandboxScope).length > 256 ||
    Array.from(original.sandboxScope).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid checkpoint provenance");
  if (metadata.compilationNanos < 0n || metadata.compilationNanos > 120000000000n)
    throw new Error("Invalid checkpoint metadata");
  const [sourceHash, problemHash, caseHash, suiteHash, frameHash, artifactHash, fatalHash] =
    await Promise.all([
      hashSource(spec.source),
      hash(spec.problemJson),
      hash(cases[ordinal]),
      hash(
        JSON.stringify([
          spec.cases,
          spec.submitSamples,
          spec.submitCasesAreSamples,
          spec.privateDetails,
        ]),
      ),
      checkpointFrameHash(frame),
      checkpointMetadataHash(metadata.artifact),
      checkpointMetadataHash(metadata.fatal),
    ]);
  const value = {
    schemaVersion: 1,
    jobId: job.jobId,
    submissionId: job.submissionId,
    problemVersionId: job.problemVersionId,
    sourceRef: job.sourceRef,
    suiteRef: job.suiteRef,
    language: job.language,
    runtimeRevision: job.runtimeRevision,
    harnessRevision: job.harnessRevision,
    ordinal,
    attemptId: original.attemptId,
    sandboxScope: original.sandboxScope,
    sourceHash,
    problemHash,
    caseHash,
    suiteHash,
    frameHash,
    artifactHash,
    fatalHash,
    compilationNanos: metadata.compilationNanos.toString(),
  } as const;
  return { ...value, binding: await bindingFor(job, spec, value) };
}
export function encodeCheckpointFrame(frame: JudgeFrame, provenance: CheckpointProvenance): string {
  const encoded = JSON.stringify(provenance);
  parseLosslessJson(encoded);
  return `{"provenance":${encoded},"frame":${encodeJudgeFrame(frame)}}`;
}
/** Old unbound checkpoint frames deliberately fail closed. */
export function decodeCheckpointFrame(raw: string): {
  frame: JudgeFrame;
  provenance: CheckpointProvenance;
} {
  const root = decodeObject(raw),
    fields = rawFields(raw),
    p = root.provenance;
  if (!p || typeof p !== "object" || Array.isArray(p) || !fields.has("frame"))
    throw new Error("Invalid checkpoint envelope");
  const o = decodeObject(stringifyLosslessJson(p));
  const frameObject = decodeObject(fields.get("frame")!);
  if (
    Object.keys(frameObject).some(
      (key) =>
        !["status", "sqlTypes", "artifact", "actual", "stdout", "stderr", "line"].includes(key),
    )
  )
    throw new Error("Invalid checkpoint frame");
  if (
    Object.keys(root).some((k) => !["provenance", "frame"].includes(k)) ||
    Object.keys(o).some(
      (k) =>
        ![
          "schemaVersion",
          "jobId",
          "submissionId",
          "problemVersionId",
          "sourceRef",
          "suiteRef",
          "language",
          "runtimeRevision",
          "harnessRevision",
          "ordinal",
          "attemptId",
          "sandboxScope",
          "sourceHash",
          "problemHash",
          "caseHash",
          "suiteHash",
          "frameHash",
          "artifactHash",
          "fatalHash",
          "compilationNanos",
          "binding",
        ].includes(k),
    )
  )
    throw new Error("Invalid checkpoint envelope");
  const schemaVersion = Number(intField(o, "schemaVersion", 1n, 1n)) as 1,
    jobId = stringField(o, "jobId"),
    submissionId = stringField(o, "submissionId"),
    problemVersionId = stringField(o, "problemVersionId"),
    sourceRef = stringField(o, "sourceRef"),
    suiteRef = stringField(o, "suiteRef"),
    language = stringField(o, "language"),
    runtimeRevision = stringField(o, "runtimeRevision"),
    harnessRevision = stringField(o, "harnessRevision"),
    ordinal = Number(intField(o, "ordinal", 0n, 2147483646n)),
    attemptId = stringField(o, "attemptId"),
    sandboxScope = stringField(o, "sandboxScope"),
    sourceHash = stringField(o, "sourceHash"),
    problemHash = stringField(o, "problemHash"),
    caseHash = stringField(o, "caseHash"),
    suiteHash = stringField(o, "suiteHash"),
    frameHash = stringField(o, "frameHash"),
    artifactHash = stringField(o, "artifactHash"),
    fatalHash = stringField(o, "fatalHash"),
    compilationNanos = stringField(o, "compilationNanos"),
    binding = stringField(o, "binding");
  if (
    ![
      sourceHash,
      problemHash,
      caseHash,
      suiteHash,
      frameHash,
      artifactHash,
      fatalHash,
      binding,
    ].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
    !/^(0|[1-9][0-9]*)$/.test(compilationNanos) ||
    BigInt(compilationNanos) > 120000000000n ||
    [
      jobId,
      submissionId,
      problemVersionId,
      sourceRef,
      suiteRef,
      language,
      runtimeRevision,
      harnessRevision,
    ].some((value) => !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) ||
    !/^[A-Za-z0-9-]{1,128}$/.test(attemptId) ||
    encoder.encode(sandboxScope).length > 256 ||
    Array.from(sandboxScope).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid checkpoint provenance");
  return {
    provenance: {
      schemaVersion,
      jobId,
      submissionId,
      problemVersionId,
      sourceRef,
      suiteRef,
      language,
      runtimeRevision,
      harnessRevision,
      ordinal,
      attemptId,
      sandboxScope,
      sourceHash,
      problemHash,
      caseHash,
      suiteHash,
      frameHash,
      artifactHash,
      fatalHash,
      compilationNanos,
      binding,
    },
    frame: decodeJudgeFrame(fields.get("frame")!),
  };
}
export async function assertCheckpointProvenance(
  job: Job,
  spec: ExecutionSpec,
  ordinal: number,
  actual: CheckpointProvenance,
  writing: boolean,
  frame: JudgeFrame,
  metadata?: Pick<Checkpoint, "artifact" | "fatal" | "compilationNanos">,
): Promise<void> {
  if (
    actual.ordinal !== ordinal ||
    actual.jobId !== job.jobId ||
    actual.submissionId !== job.submissionId ||
    actual.problemVersionId !== job.problemVersionId ||
    actual.sourceRef !== job.sourceRef ||
    actual.suiteRef !== job.suiteRef ||
    actual.language !== job.language ||
    actual.runtimeRevision !== job.runtimeRevision ||
    actual.harnessRevision !== job.harnessRevision ||
    actual.sandboxScope !== job.sandboxScope ||
    (writing && actual.attemptId !== job.attemptId)
  )
    throw new Error("Checkpoint fence mismatch");
  const expected = await checkpointProvenance(
    job,
    spec,
    ordinal,
    {
      attemptId: actual.attemptId,
      sandboxScope: actual.sandboxScope,
    },
    metadata ?? { compilationNanos: BigInt(actual.compilationNanos) },
    frame,
  );
  const compared = metadata
    ? expected
    : {
        ...expected,
        artifactHash: actual.artifactHash,
        fatalHash: actual.fatalHash,
        compilationNanos: actual.compilationNanos,
      };
  const binding = await bindingFor(job, spec, compared);
  if (
    compared.sourceHash !== actual.sourceHash ||
    compared.problemHash !== actual.problemHash ||
    compared.caseHash !== actual.caseHash ||
    compared.suiteHash !== actual.suiteHash ||
    compared.frameHash !== actual.frameHash ||
    compared.artifactHash !== actual.artifactHash ||
    compared.fatalHash !== actual.fatalHash ||
    compared.compilationNanos !== actual.compilationNanos ||
    binding !== actual.binding
  )
    throw new Error("Checkpoint provenance mismatch");
}
