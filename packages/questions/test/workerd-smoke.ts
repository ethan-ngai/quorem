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
