import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  validSource,
  type JsonValue,
} from "@quorem/questions";
import { sourceHash, workspaceCommandFingerprint } from "@quorem/execution";
import { ApplicationError } from "../../../application/error.ts";

export interface WorkspaceCommand {
  workspaceId: string;
  kind: "run" | "submit";
  source: string;
  level: number;
  customCases: string[] | null;
  fingerprint: string;
  sourceHash: string;
}
const invalid = () => new ApplicationError("invalid_input", "Invalid execution command", 400);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw invalid();
  return value;
}
function keys(value: Record<string, JsonValue>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}
function goCase(value: JsonValue): string {
  const c = object(value);
  keys(c, ["calls", "args", "expected"]);
  const args = c.args ?? null;
  if (args !== null && !Array.isArray(args)) throw invalid();
  let result = "{";
  if (c.calls !== undefined && c.calls !== null) {
    if (!Array.isArray(c.calls)) throw invalid();
    if (c.calls.length) {
      const calls = c.calls.map((value) => {
        const call = object(value);
        keys(call, ["methodName", "args", "expected"]);
        if (call.methodName !== undefined && typeof call.methodName !== "string") throw invalid();
        if (call.args !== undefined && call.args !== null && !Array.isArray(call.args))
          throw invalid();
        return `{"methodName":${stringifyLosslessJson(call.methodName ?? "")},"args":${stringifyLosslessJson(call.args ?? null)}${call.expected !== undefined ? `,"expected":${stringifyLosslessJson(call.expected)}` : ""}}`;
      });
      result += `"calls":[${calls.join(",")}],`;
    }
  }
  result += `"args":${stringifyLosslessJson(args)}`;
  if (c.expected !== undefined) result += `,"expected":${stringifyLosslessJson(c.expected)}`;
  return result + "}";
}
/** Validates the public command and derives the source identity on the server. */
export async function parseWorkspaceCommand(raw: string, key: string): Promise<WorkspaceCommand> {
  if (
    !key ||
    new TextEncoder().encode(key).length > 128 ||
    new TextEncoder().encode(raw).length > 2 * 1024 * 1024 + 512 * 1024
  )
    throw invalid();
  let c: Record<string, JsonValue>;
  try {
    c = object(parseLosslessJson(raw));
    keys(c, ["level", "workspaceId", "kind", "source", "customCases"]);
  } catch {
    throw invalid();
  }
  const workspaceId = c.workspaceId ?? "",
    kind = c.kind ?? "",
    source = c.source ?? "";
  if (
    typeof workspaceId !== "string" ||
    !uuid.test(workspaceId) ||
    (kind !== "run" && kind !== "submit") ||
    typeof source !== "string" ||
    !validSource(source)
  )
    throw invalid();
  let level = 0;
  if (c.level !== undefined && c.level !== null) {
    if (!(c.level instanceof JsonNumber) || !/^-?\d+$/.test(c.level.lexeme)) throw invalid();
    level = Number(c.level.lexeme);
    if (!Number.isSafeInteger(level)) throw invalid();
  }
  let cases: string[] | null = null;
  if (c.customCases !== undefined && c.customCases !== null) {
    if (
      !Array.isArray(c.customCases) ||
      kind !== "run" ||
      c.customCases.length < 1 ||
      c.customCases.length > 20
    )
      throw invalid();
    cases = c.customCases.map(goCase);
    if (new TextEncoder().encode(`[${cases.join(",")}]`).length > 2 * 1024 * 1024) throw invalid();
  }
  return {
    workspaceId,
    kind,
    source,
    level,
    customCases: cases,
    fingerprint: await workspaceCommandFingerprint(raw),
    sourceHash: await sourceHash(source),
  };
}
