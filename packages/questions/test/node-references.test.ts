/** @file node-references.test.ts @description Case validation and judging for node references. @module questions */
import { expect, test } from "vitest";
import { compareCodingCase, validateCodingCase } from "../src/coding-case.ts";
import type { Signature } from "../src/model.ts";
import { normalizeQuestionJson } from "../src/value-codec.ts";

const signature: Signature = {
  className: "Solution",
  methodName: "intersection",
  parameters: [
    { name: "a", type: "ListNode" },
    { name: "b", type: "ListNode" },
  ],
  returnType: "ListNode",
  nodeReferences: "return",
};

test("compares input identities and validates constraints on a shared tail", () => {
  const json = '{"args":[[4,8,5],{"values":[6],"tail":[0,1]}],"expected":{"ref":[0,1]}}';
  validateCodingCase(
    signature,
    [{ kind: "range", target: { parameter: "b", projection: "nodeCount" }, min: 3, max: 3 }],
    json,
  );
  expect(compareCodingCase(signature, [], json, "executed", '{"ref":[0,1]}').status).toBe(
    "accepted",
  );
  expect(compareCodingCase(signature, [], json, "executed", '{"ref":[1,0]}').status).toBe(
    "wrong_answer",
  );
  expect(compareCodingCase(signature, [], json, "executed", '{"ref":[1,1]}').status).toBe(
    "invalid_output",
  );
  expect(compareCodingCase(signature, [], json, "executed", "[8,5]").status).toBe("invalid_output");
  expect(() => validateCodingCase({ ...signature, nodeReferences: undefined }, [], json)).toThrow();
});

test("rejects references to aliases and across incompatible node types", () => {
  const aliases = '{"args":[{"ref":[1,0]},{"ref":[0,0]}],"expected":null}';
  expect(() => validateCodingCase(signature, [], aliases)).toThrow("argument seed");
  const mixed: Signature = {
    ...signature,
    parameters: [signature.parameters[0], { name: "b", type: "TreeNode" }],
  };
  const mismatch = '{"args":[[4],{"ref":[0,0]}],"expected":null}';
  expect(() => validateCodingCase(mixed, [], mismatch)).toThrow("compatible node");
});

test("counts reachable list nodes once through cycles and projects a tree alias", () => {
  const cycle = '{"args":[{"ref":[1,2]},{"values":[1,2,3],"tail":[1,1]}],"expected":{"ref":[1,1]}}';
  validateCodingCase(
    signature,
    [{ kind: "range", target: { parameter: "a", projection: "nodeCount" }, min: 2, max: 2 }],
    cycle,
  );
  const tree = {
    ...signature,
    parameters: [
      { name: "a", type: "TreeNode" },
      { name: "b", type: "TreeNode" },
    ],
    returnType: "TreeNode",
  };
  validateCodingCase(
    tree,
    [{ kind: "range", target: { parameter: "b", projection: "nodeCount" }, min: 2, max: 2 }],
    '{"args":[[1,null,2,3],{"ref":[0,1]}],"expected":{"ref":[0,2]}}',
  );
});

test("normalizes N-ary child groups and rejects orphan groups", () => {
  expect(normalizeQuestionJson("NaryTreeNode<str>", '["a",null,"b","c",null,null,"d",null]')).toBe(
    '["a",null,"b","c",null,null,"d"]',
  );
  expect(normalizeQuestionJson("NaryTreeNode", "[]")).toBe("null");
  expect(() => normalizeQuestionJson("NaryTreeNode", "[1,2]")).toThrow("null");
  expect(() => normalizeQuestionJson("NaryTreeNode", "[1,null,null,null,2]")).toThrow("orphan");
});
