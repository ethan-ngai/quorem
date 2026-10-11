/** @file customCases.ts @description Validates typed JSON values before Run admission. @module editor */
import type { CustomCase } from "@quorem/contracts";

function validateWireValue(value: unknown, depth = 0): value is CustomCase["args"][number] {
  if (depth > 100) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") {
    return (
      Number.isFinite(value) &&
      (!Number.isInteger(value) || (value >= -2_147_483_648 && value <= 2_147_483_647))
    );
  }
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((item) => validateWireValue(item, depth + 1))
  );
}

/** Parses 1–20 custom case records and enforces the public wire bounds. */
export function parseCustomCases(source: string): CustomCase[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) {
    throw new Error("Enter between 1 and 20 cases as a JSON array.");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Case ${index + 1} must be an object with an args array.`);
    }
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.args) || !record.args.every((value) => validateWireValue(value))) {
      throw new Error(`Case ${index + 1} has invalid args. Use JSON values and 32-bit integers.`);
    }
    if ("expected" in record && !validateWireValue(record.expected)) {
      throw new Error(`Case ${index + 1} has an invalid expected value.`);
    }
    return {
      args: record.args,
      ...(record.expected === undefined ? {} : { expected: record.expected }),
    } as CustomCase;
  });
}
