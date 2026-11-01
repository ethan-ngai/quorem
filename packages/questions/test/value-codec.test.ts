import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeQuestionJson,
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
  for (const v of vectors.filter((v) => v.name === "normalize"))
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
