/** @file checkpoint.ts @description Private checkpoint bounds and lossless Go JSON mapping. @module execution */
import { parseLosslessJson } from "@quorem/questions";
import type { Checkpoint, CheckpointCase } from "./contracts.ts";
import { decodeObject, intField, rawFields } from "./wire.ts";
import { decodeManifestCheckpointFrame } from "./manifest-checkpoint.ts";
const byteLength = (s: string) => new TextEncoder().encode(s).length;
function validate(value: CheckpointCase, bound = true): void {
  if (
    !Number.isInteger(value.ordinal) ||
    value.ordinal < 0 ||
    value.ordinal > 2147483646 ||
    value.compilationNanos < 0n ||
    value.compilationNanos > 120000000000n
  )
    throw new Error("invalid checkpoint");
  for (const [part, max] of [
    [value.frame, (2 << 20) + 4096],
    [value.artifact, 4 << 20],
    [value.fatal, 2 << 20],
  ] as const) {
    if (part === undefined) continue;
    if (byteLength(part) > max) throw new Error("invalid checkpoint");
    try {
      parseLosslessJson(part);
    } catch {
      throw new Error("invalid checkpoint");
    }
  }
  if (bound) {
    if (decodeManifestCheckpointFrame(value.frame).provenance.ordinal !== value.ordinal)
      throw new Error("checkpoint ordinal mismatch");
    const raw = rawFields(value.frame).get("frame");
    if (!raw || byteLength(raw) > 2 << 20) throw new Error("checkpoint frame exceeded");
  }
}
/** Encode a private Go checkpoint struct without parsing opaque JSON fields into numbers. */
export function encodeCheckpointCase(value: CheckpointCase): string {
  validate(value);
  return `{"Ordinal":${value.ordinal},"Frame":${value.frame},"Artifact":${value.artifact ?? "null"},"CompilationNanos":${value.compilationNanos},"Fatal":${value.fatal ?? "null"}}`;
}
/** Decode a checkpoint while retaining exact raw frame and artifact JSON bytes. */
export function decodeCheckpointCase(json: string): CheckpointCase {
  const obj = decodeObject(json),
    fields = rawFields(json),
    frame = fields.get("Frame"),
    artifact = fields.get("Artifact"),
    fatal = fields.get("Fatal");
  if (frame === undefined) throw new Error("invalid checkpoint");
  const value: CheckpointCase = {
    ordinal: Number(intField(obj, "Ordinal", 0n, 2147483646n)),
    frame,
    artifact: artifact === "null" ? undefined : artifact,
    compilationNanos: intField(obj, "CompilationNanos", 0n, 120000000000n),
    fatal: fatal === "null" ? undefined : fatal,
  };
  validate(value);
  return value;
}

/** Encode checkpoint metadata using the existing Go struct field names. */
export function encodeCheckpoint(value: Checkpoint): string {
  if (
    !Number.isInteger(value.nextOrdinal) ||
    value.nextOrdinal < 0 ||
    value.nextOrdinal > 2147483647
  )
    throw new Error("invalid checkpoint");
  validate(
    {
      ordinal: 0,
      frame: "null",
      artifact: value.artifact,
      compilationNanos: value.compilationNanos,
      fatal: value.fatal,
    },
    false,
  );
  return `{"NextOrdinal":${value.nextOrdinal},"Artifact":${value.artifact ?? "null"},"CompilationNanos":${value.compilationNanos},"Fatal":${value.fatal ?? "null"}}`;
}
/** Decode checkpoint metadata while retaining opaque JSON values. */
export function decodeCheckpoint(json: string): Checkpoint {
  const obj = decodeObject(json),
    fields = rawFields(json),
    artifact = fields.get("Artifact"),
    fatal = fields.get("Fatal");
  const value: Checkpoint = {
    nextOrdinal: Number(intField(obj, "NextOrdinal", 0n, 2147483647n)),
    artifact: artifact === "null" ? undefined : artifact,
    compilationNanos: intField(obj, "CompilationNanos", 0n, 120000000000n),
    fatal: fatal === "null" ? undefined : fatal,
  };
  encodeCheckpoint(value);
  return value;
}
