import assert from "node:assert/strict";
import { generateStarter, validateSignature } from "../src/index.ts";

const signature = {
  className: "Solution",
  methodName: "answer",
  parameters: [],
  returnType: "int",
};
validateSignature(signature);
assert.match(generateStarter([signature], "python", false), /def answer\(self\)/);
const { normalizeQuestionJson, parseLosslessJson, stringifyLosslessJson } =
  await import("../src/index.ts");
assert.equal(normalizeQuestionJson("TreeNode", "[1,null,2,null,null]"), "[1,null,2]");
assert.equal(stringifyLosslessJson(parseLosslessJson("9007199254740993")), "9007199254740993");
const { normalizeSqlResult, compareCodingCase } = await import("../src/index.ts");
assert.equal(
  normalizeSqlResult(
    { dialect: "postgresql", outputOrder: "ordered", output: [{ name: "n", type: "numeric" }] },
    '{"rows":[[{"$numeric":"1.00"}]]}',
  ),
  '{"columns":["n"],"rows":[[{"$numeric":"1"}]]}',
);
assert.equal(
  compareCodingCase(signature, [], '{"args":[],"expected":1}', "executed", "1").status,
  "accepted",
);
