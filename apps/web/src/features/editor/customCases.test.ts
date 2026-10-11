import type { CustomCase, Signature } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import {
  associatedResultIndex,
  parseCustomCases,
  parseCustomDrafts,
  parseTypedField,
  validateTypedValue,
  type CustomCaseDraft,
  type RunSnapshot,
} from "./customCases";

const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [
    { name: "values", type: "list<int>" },
    { name: "enabled", type: "bool" },
  ],
  returnType: "int",
};
const draft: CustomCaseDraft = {
  id: "first",
  args: ["[1, 2]", "true"],
  expectedEnabled: false,
  expected: "3",
};

describe("typed custom cases", () => {
  it("serializes declared argument order and optional expected output", () => {
    expect(parseCustomDrafts([draft], signature)).toEqual([{ args: [[1, 2], true] }]);
    expect(parseCustomDrafts([{ ...draft, expectedEnabled: true }], signature)).toEqual([
      { args: [[1, 2], true], expected: 3 },
    ]);
    expect(parseTypedField("str", 'a "quoted" string\n')).toBe('a "quoted" string\n');
    expect(parseTypedField("optional<str>", '"text"')).toBe("text");
  });

  it("rejects malformed fields, wrong arity, integer coercion and wrong output types", () => {
    for (const source of [
      "{",
      "[]",
      '[{"args":{}}]',
      '[{"args":[[2147483648],true]}]',
      '[{"args":[[true],true]}]',
      '[{"args":[[],1]}]',
      '[{"args":[[],true],"expected":"3"}]',
      '[{"args":[[],true],"extra":1}]',
    ])
      expect(() => parseCustomCases(source, signature)).toThrow();
    expect(() => parseCustomDrafts([{ ...draft, args: ["[1,"] }], signature)).toThrow(
      "argument count",
    );
    expect(() => parseCustomDrafts([{ ...draft, args: ["[1,", "true"] }], signature)).toThrow(
      "Case 1: values",
    );
    expect(() => parseTypedField("int", "1.5")).toThrow("integer");
    expect(() => parseTypedField("float", "1e400")).toThrow("finite");
  });

  it("validates recursive lists and both node encodings", () => {
    expect(parseTypedField("list<list<int>>", "[[1,2],[]]")).toEqual([[1, 2], []]);
    expect(parseTypedField("optional<ListNode>", "null")).toBeNull();
    expect(parseTypedField("TreeNode", "[1,null,2,3]")).toEqual([1, null, 2, 3]);
    for (const [type, source] of [
      ["list<list<int>>", "[[1,true]]"],
      ["ListNode", "[1,null]"],
      ["TreeNode", "[null,1]"],
      ["TreeNode", "[1,null,null,2]"],
      ["TreeNode", '{"val":1}'],
    ])
      expect(() => parseTypedField(type!, source!)).toThrow();
  });

  it("enforces per-value total size, depth, case count and request byte bounds", () => {
    expect(() => parseCustomDrafts([], signature)).toThrow("between 1 and 20");
    expect(() =>
      parseCustomDrafts(
        Array.from({ length: 21 }, () => draft),
        signature,
      ),
    ).toThrow("between 1 and 20");
    expect(() => parseTypedField("list<int>", JSON.stringify(Array(10001).fill(0)))).toThrow(
      "10,000",
    );
    expect(() =>
      parseTypedField(
        "list<list<int>>",
        JSON.stringify([Array(5000).fill(0), Array(5000).fill(0)]),
      ),
    ).toThrow("10,000");
    let type = "int";
    let value: unknown = 0;
    for (let depth = 0; depth < 102; depth++) {
      type = `list<${type}>`;
      value = [value];
    }
    expect(() => validateTypedValue(type, value)).toThrow("nested type");
    const strings: Signature = { ...signature, parameters: [{ name: "text", type: "str" }] };
    expect(() => parseCustomDrafts([{ ...draft, args: ["é".repeat(33000)] }], strings)).toThrow(
      "64 KiB",
    );
  });

  it("associates results with stable IDs and exact admission values", () => {
    const value: CustomCase = { args: [[1, 2], true] };
    const snapshot: RunSnapshot = {
      problemVersionId: "version",
      custom: true,
      cases: [
        { id: "first", value },
        { id: "second", value },
      ],
    };
    expect(associatedResultIndex(snapshot, true, "second", value)).toBe(1);
    expect(associatedResultIndex(snapshot, true, "first", { args: [[2, 1], true] })).toBe(-1);
    expect(associatedResultIndex(snapshot, true, "new", value)).toBe(-1);
    expect(associatedResultIndex(snapshot, false, "first", value)).toBe(-1);
    expect(associatedResultIndex(undefined, true, "first", value)).toBe(-1);
  });
});
