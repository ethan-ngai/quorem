/** @file customCases.test.ts @description Covers typed custom-case validation and bounds. @module editor */
import { describe, expect, it } from "vitest";
import { parseCustomCases } from "./customCases";

describe("parseCustomCases", () => {
  it("preserves supported JSON arguments and optional expected values", () => {
    expect(parseCustomCases('[{"args":[3,"x",true,null,[1,2]],"expected":4}]')).toEqual([
      { args: [3, "x", true, null, [1, 2]], expected: 4 },
    ]);
  });

  it("rejects malformed records, non-finite integers, and out-of-range values", () => {
    for (const input of [
      "{",
      "[]",
      '[{"args":{}}]',
      '[{"args":[2147483648]}]',
      '[{"args":[],"expected":{}}]',
    ]) {
      expect(() => parseCustomCases(input)).toThrow();
    }
  });

  it("enforces the case-count and nested-value limits", () => {
    expect(() => parseCustomCases("[]")).toThrow("between 1 and 20");
    expect(() =>
      parseCustomCases(JSON.stringify(Array.from({ length: 21 }, () => ({ args: [] })))),
    ).toThrow("between 1 and 20");

    let nested: unknown = 0;
    for (let depth = 0; depth < 102; depth += 1) nested = [nested];
    expect(() => parseCustomCases(JSON.stringify([{ args: [nested] }]))).toThrow("invalid args");
  });
});
