/** @file fingerprint-input.ts @description Validated raw case spans for operation replay. @module interviews */
import { parseLosslessJson, stringifyLosslessJson } from "@quorem/questions";
import { losslessObject } from "../../../../modules/interviews/question/fingerprint.ts";
import { markRawInterviewCases } from "../../problems/case-literals.ts";

/** Raw bytes are accepted only when they represent the same decoded question. */
export function fingerprintQuestionInput(
  question: unknown,
  raw: string | undefined,
  wrapped: boolean,
): { question: unknown; marks?: ReadonlyMap<string, string> } {
  if (raw === undefined) return { question };
  if (new TextEncoder().encode(raw).length > 256 * 1024)
    throw new Error("Question request too large");
  const decoded = losslessObject(parseLosslessJson(raw)),
    value = wrapped ? decoded.question : decoded;
  const original = losslessObject(question),
    candidate = losslessObject(value);
  if (stringifyLosslessJson(original) !== stringifyLosslessJson(candidate))
    throw new Error("Question input mismatch");
  return { question: candidate, marks: markRawInterviewCases(raw, candidate, wrapped) };
}
