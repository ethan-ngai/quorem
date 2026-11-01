/** @file storage.ts @description Lossless case sidecars for PostgreSQL authoring. @module problems */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
type Obj = { [key: string]: JsonValue };
export function object(value: JsonValue | undefined): Obj {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("invalid question content");
  return value;
}
function containsNul(v: JsonValue): boolean {
  if (typeof v === "string") return v.includes("\0");
  if (Array.isArray(v)) return v.some(containsNul);
  if (v && typeof v === "object" && !(v instanceof JsonNumber))
    return Object.entries(v).some(([key, item]) => key.includes("\0") || containsNul(item));
  return false;
}
function needsRaw(v: JsonValue): boolean {
  if (v instanceof JsonNumber) return /[eE]/.test(v.lexeme) || /^-0(?:\.0+)?$/.test(v.lexeme);
  if (Array.isArray(v)) return v.some(needsRaw);
  if (v && typeof v === "object") return Object.values(v).some(needsRaw);
  return false;
}

function clean(v: JsonValue): JsonValue {
  if (typeof v === "string") return v.replaceAll("\0", "");
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object" && !(v instanceof JsonNumber))
    return Object.fromEntries(
      Object.entries(v).map(([key, item]) => [key.replaceAll("\0", ""), clean(item)]),
    );
  return v;
}
/** Preserve case NULs and numeric lexemes that JSONB would rewrite. */
export function storageProjection(raw: string): { safe: string; lossless: Uint8Array | null } {
  const root = object(parseLosslessJson(raw));
  let changed = false;
  const replace = (o: Obj, key: string) => {
    const value = o[key];
    if (value !== undefined) {
      if (needsRaw(value)) changed = true;
      if (containsNul(value)) {
        o[key] = clean(value);
        changed = true;
      }
    }
  };
  replace(root, "hiddenCases");
  replace(root, "odysseyHiddenCases");
  if (root.problem) {
    const problem = object(root.problem);
    replace(problem, "examples");
    if (problem.odyssey) {
      const odyssey = object(problem.odyssey);
      if (Array.isArray(odyssey.levels))
        for (const level of odyssey.levels) replace(object(level), "examples");
    }
  }
  if (containsNul(root)) throw new Error("NUL is allowed only in coding case values");
  return {
    safe: stringifyLosslessJson(root),
    lossless: changed ? new TextEncoder().encode(raw) : null,
  };
}

/** Execution cases use the same JSONB-safe projection and exact sidecar. */
export function caseStorageProjection(raw: string): { safe: string; lossless: Uint8Array | null } {
  const value = parseLosslessJson(raw);
  if (!Array.isArray(value)) throw new Error("invalid execution cases");
  const changed = containsNul(value) || needsRaw(value);
  return {
    safe: stringifyLosslessJson(changed ? clean(value) : value),
    lossless: changed ? new TextEncoder().encode(raw) : null,
  };
}
