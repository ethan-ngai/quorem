/** @file changes.ts @description CodeMirror changes with source integrity checks. @module interviews */
import { ChangeSet, Text } from "@codemirror/state";
import { validSource } from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid change set", 400);
/** Apply one ordered ChangeSet to a UTF-16 document, rejecting malformed source. */
export function applyDocumentChanges(source: string, value: unknown): string {
  if (!validSource(source) || !Array.isArray(value) || value.length > 4096) throw invalid();
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw invalid();
  }
  if (new TextEncoder().encode(encoded).length > 131072) throw invalid();
  for (const part of value) {
    if (typeof part === "number") {
      if (!Number.isSafeInteger(part) || part < 0) throw invalid();
    } else if (
      Array.isArray(part) &&
      part.length &&
      Number.isSafeInteger(part[0]) &&
      part[0] >= 0
    ) {
      for (const line of part.slice(1))
        if (typeof line !== "string" || line.includes("\n") || !validSource(line)) throw invalid();
    } else throw invalid();
  }
  try {
    const result = ChangeSet.fromJSON(value)
      .apply(Text.of(source.split("\n")))
      .toString();
    if (!validSource(result)) throw invalid();
    return result;
  } catch {
    throw invalid();
  }
}
