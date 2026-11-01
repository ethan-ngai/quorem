/** @file checkpoint-provenance.ts @description Stable hashes for manifest checkpoint metadata. @module execution */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { encodeJudgeFrame, type JudgeFrame } from "./judge-frame.ts";
const encoder = new TextEncoder();
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
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
