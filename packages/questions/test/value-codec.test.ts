import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareCodingCase,
  normalizeQuestionJson,
  validateCodingCase,
  parseLosslessJson,
  stringifyLosslessJson,
  validSource,
} from "../src/index.ts";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/migration/public/go-oracle.json", import.meta.url),
    "utf8",
  ),
) as { name: string; input: { type: string; json: string }; output?: string; error?: string }[];
describe("Go coding value vectors", () => {
  for (const v of vectors.filter((v) => v.name === "normalize" && v.input.type !== "long"))
    it(`${v.input.type} ${v.input.json}`, () => {
      if (v.error) expect(() => normalizeQuestionJson(v.input.type, v.input.json)).toThrow(v.error);
      else expect(normalizeQuestionJson(v.input.type, v.input.json)).toBe(v.output);
    });
});
it("retains numeric lexemes and rejects malformed input", () => {
  expect(stringifyLosslessJson(parseLosslessJson('{"x":9007199254740993,"y":-0.00e+3}'))).toBe(
    '{"x":9007199254740993,"y":-0.00e+3}',
  );
  for (const input of ["01", "[1,]", '{"a":1,}', "1 2"])
    expect(() => parseLosslessJson(input)).toThrow();
  expect(normalizeQuestionJson("TreeNode", "[1,null,2,null,null]")).toBe("[1,null,2]");
  expect(() => normalizeQuestionJson("TreeNode", "[1,null,null,2]")).toThrow();
  expect(() => normalizeQuestionJson("list<int>", "[1,2]", 1)).toThrow();
  expect(validSource("a\u0000b")).toBe(false);
});
it("bounds large collections and preserves lossless object keys", () => {
  const tenThousand = `[${Array(10000).fill("1").join(",")}]`;
  expect(normalizeQuestionJson("list<int>", tenThousand)).toBe(tenThousand);
  expect(() => normalizeQuestionJson("list<int>", `[${Array(10001).fill("1").join(",")}]`)).toThrow(
    "collection exceeds",
  );
  expect(stringifyLosslessJson(parseLosslessJson('{"__proto__":{"x":1}}'))).toBe(
    '{"__proto__":{"x":1}}',
  );
  expect(stringifyLosslessJson(parseLosslessJson('"\\ud800"'))).toBe('"�"');
});

it("preserves exact signed long values in nested coding cases", () => {
  const json = '["-9223372036854775808",null,"9007199254740993","9223372036854775807"]';
  expect(normalizeQuestionJson("array<optional<long>>", json)).toBe(json);
  for (const invalid of [
    '"9223372036854775808"',
    '"-9223372036854775809"',
    '"-0"',
    '"01"',
    '"+1"',
    JSON.stringify("1\n"),
    "9007199254740993",
  ])
    expect(() => normalizeQuestionJson("long", invalid)).toThrow("signed 64-bit");
  expect(() => normalizeQuestionJson("int", "2147483648")).toThrow("signed 32-bit");
});

it("judges adjacent wide integers exactly and applies long comparisons", () => {
  const signature = {
    className: "Solution" as const,
    methodName: "solve",
    parameters: [
      { name: "a", type: "long" },
      { name: "b", type: "long" },
    ],
    returnType: "long",
  };
  const fixture = '{"args":["9007199254740992","9007199254740993"],"expected":"9007199254740993"}';
  const a = { parameter: "a", projection: "value" as const };
  const b = { parameter: "b", projection: "value" as const };
  expect(() =>
    validateCodingCase(
      signature,
      [{ kind: "comparison", left: a, operator: "lt", right: b }],
      fixture,
    ),
  ).not.toThrow();
  expect(() =>
    validateCodingCase(
      signature,
      [{ kind: "comparison", left: a, operator: "eq", right: b }],
      fixture,
    ),
  ).toThrow("comparison");
  expect(compareCodingCase(signature, [], fixture, "executed", '"9007199254740993"').status).toBe(
    "accepted",
  );
  expect(compareCodingCase(signature, [], fixture, "executed", '"9007199254740992"').status).toBe(
    "wrong_answer",
  );
});

it("preserves typed node values, sparse tree positions, and legacy integer rules", () => {
  expect(normalizeQuestionJson("TreeNode<str>", '["root",null,"right",null,null]')).toBe(
    '["root",null,"right"]',
  );
  expect(normalizeQuestionJson("ListNode<long>", '["9007199254740993"]')).toBe(
    '["9007199254740993"]',
  );
  expect(normalizeQuestionJson("ListNode<bool>", "[]")).toBe("null");
  expect(() => normalizeQuestionJson("TreeNode<str>", '["a",null,null,"orphan"]')).toThrow(
    "orphan tree node",
  );
  expect(() => normalizeQuestionJson("ListNode<str>", "[null]")).toThrow();
  expect(() => normalizeQuestionJson("TreeNode<optional<int>>", "[1]")).toThrow(
    "unknown or excessively nested type",
  );
  expect(() => normalizeQuestionJson("TreeNode", '["legacy"]')).toThrow("expected integer");
});
