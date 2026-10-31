/** @file judge-frame.ts @description Private judge case frame JSON mapping. @module execution */
import { parseLosslessJson, stringifyLosslessJson } from "@quorem/questions";
import { decodeObject, intField, rawFields, stringField } from "./wire.ts";
export interface JudgeFrame {
  readonly status: string;
  readonly sqlTypes?: readonly string[];
  readonly artifact?: string;
  readonly actual: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly line: number;
}
/** Encode a runner case frame without converting raw result or artifact values. */
export function encodeJudgeFrame(frame: JudgeFrame): string {
  if (!frame.status || !Number.isSafeInteger(frame.line) || frame.line < 0)
    throw new Error("invalid judge frame");
  parseLosslessJson(frame.actual);
  if (frame.artifact !== undefined) parseLosslessJson(frame.artifact);
  const quote = (value: string) => stringifyLosslessJson(value);
  return `{"status":${quote(frame.status)}${frame.sqlTypes?.length ? `,"sqlTypes":${stringifyLosslessJson([...frame.sqlTypes])}` : ""}${frame.artifact !== undefined ? `,"artifact":${frame.artifact}` : ""},"actual":${frame.actual},"stdout":${quote(frame.stdout)},"stderr":${quote(frame.stderr)},"line":${frame.line}}`;
}
/** Decode a runner frame, preserving raw numeric and artifact JSON. */
export function decodeJudgeFrame(json: string): JudgeFrame {
  const o = decodeObject(json),
    raw = rawFields(json),
    actual = raw.get("actual");
  if (actual === undefined || typeof o.stdout !== "string" || typeof o.stderr !== "string")
    throw new Error("invalid judge frame");
  const types = o.sqlTypes;
  if (types !== undefined && (!Array.isArray(types) || types.some((v) => typeof v !== "string")))
    throw new Error("invalid judge frame");
  return {
    status: stringField(o, "status"),
    sqlTypes: types as string[] | undefined,
    artifact: raw.get("artifact"),
    actual,
    stdout: o.stdout,
    stderr: o.stderr,
    line: Number(intField(o, "line", 0n, 2147483647n)),
  };
}
