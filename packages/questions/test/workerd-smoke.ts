import { expect, it } from "vitest";
import {
  normalizeQuestionJson,
  normalizeSqlResult,
  parseLosslessJson,
  stringifyLosslessJson,
} from "../src/index.ts";

it("imports and executes lossless question codecs in workerd", () => {
  expect(normalizeQuestionJson("TreeNode", "[1,null,2,null,null]")).toBe("[1,null,2]");
  expect(stringifyLosslessJson(parseLosslessJson("9007199254740993"))).toBe("9007199254740993");
  expect(
    normalizeSqlResult(
      { dialect: "postgresql", outputOrder: "ordered", output: [{ name: "n", type: "numeric" }] },
      '{"rows":[[{"$numeric":"1.00"}]]}',
    ),
  ).toBe('{"columns":["n"],"rows":[[{"$numeric":"1"}]]}');
});

import { assertDifferentialVectors } from "./differential.ts";
it("matches Go edge vectors in workerd", assertDifferentialVectors);
import { normalizeQuestionDraft, validateQuestionSchema } from "../src/index.ts";
it("uses the generated question schema without runtime code generation", () => {
  const raw = normalizeQuestionDraft('{"problem":{},"hiddenCases":[{"args":[1e309]}]}');
  expect(raw).toContain("1e309");
  expect(() => validateQuestionSchema(raw)).not.toThrow();
});
