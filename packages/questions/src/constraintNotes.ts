/** @file constraintNotes.ts @description Conservative suggestions for structured replacements of author notes. @module questions */
import { validateConstraints } from "./constraints.ts";
import type { Constraint, ConstraintTarget, Signature } from "./model.ts";

const alphabet = {
  "lowercase english letters": "abcdefghijklmnopqrstuvwxyz",
  "uppercase english letters": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "english letters": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
};
const access = "[A-Za-z][A-Za-z0-9_]*(?:\\[(?:[ijk]|[0-9]{1,5})\\])*(?:\\.length)?";
const noteSet = new RegExp(`^(${access})\\s*\\\\in\\s*\\\\\\{(.+)\\\\\\}$`);
const relation = new RegExp(`^(-?\\d+)\\s*(<=|<)\\s*(${access})\\s*(<=|<)\\s*(-?\\d+)$`);

function repeatedIndex(source: string) {
  const names = [...source.matchAll(/\[([ijk])\]/g)].map((match) => match[1]);
  return new Set(names).size !== names.length;
}

function target(source: string): ConstraintTarget {
  const parameter = source.match(/^[A-Za-z][A-Za-z0-9_]*/)![0];
  const path = [...source.matchAll(/\[([ijk]|\d+)\]/g)].map(([, step]) =>
    /^\d/.test(step) ? Number(step) : ("each" as const),
  );
  return {
    parameter,
    projection: source.endsWith(".length") ? "length" : "value",
    ...(path.length && { path }),
  };
}

function suggestion(signature: Signature, source: string): Constraint | undefined {
  const note = source.trim().replace(/[$`]/g, "").replace(/\.$/, "").trim();
  const bounds = relation.exec(note.replaceAll("\\le", "<=").replaceAll("≤", "<="));
  if (bounds) {
    const [, min, lower, name, upper, max] = bounds;
    if (repeatedIndex(name) || ![min, max].every((value) => Number.isSafeInteger(Number(value))))
      return;
    return {
      kind: "range",
      target: target(name),
      min: Number(min),
      max: Number(max),
      ...(lower === "<" && { minInclusive: false }),
      ...(upper === "<" && { maxInclusive: false }),
    };
  }
  const set = noteSet.exec(note);
  if (set && /^-?\d+(?:\s*,\s*-?\d+)*$/.test(set[2].trim())) {
    if (repeatedIndex(set[1])) return;
    return { kind: "membership", target: target(set[1]), values: set[2].split(",").map(Number) };
  }
  const characterNote =
    /^([A-Za-z][A-Za-z0-9_]*) (?:consists? of|contains?) (?:only )?(lowercase English letters|uppercase English letters|English letters|digits)(?: only)?$/i.exec(
      note,
    );
  if (characterNote)
    return {
      kind: "membership",
      target: { parameter: characterNote[1], projection: "characters" },
      values: Array.from(alphabet[characterNote[2].toLowerCase() as keyof typeof alphabet]),
    };
  const length = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*\.length)$/.exec(note);
  if (length) {
    const [, name, measurement] = length;
    return signature.parameters.some((parameter) => parameter.name === name)
      ? { kind: "comparison", left: target(name), right: target(measurement), operator: "eq" }
      : { kind: "definition", name, target: target(measurement) };
  }
}

/** Suggest exact, type-checked replacements; ambiguous prose stays editable. */
export function structuredConstraintSuggestion(
  signature: Signature,
  note: string,
): Constraint | undefined {
  if (note.length > 4096) return;
  const candidate = suggestion(signature, note);
  if (!candidate) return;
  try {
    validateConstraints(signature, [candidate]);
    return candidate;
  } catch {
    return undefined;
  }
}
