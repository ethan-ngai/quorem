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
