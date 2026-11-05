/** @file nodeLiterals.test.ts @description Centered tree editing and preorder reference round trips. @module editor */
import { expect, it } from "vitest";
import type { Signature } from "@quorem/contracts";
import { formatNodeLiteral, parseNodeLiteral } from "./nodeLiterals";
import { createCustomDraft, parseCustomDraft } from "./customCases";
import type { QuestionProblem } from "@quorem/contracts";

it("round-trips centered groups including sparse slots and leaf placeholders", () => {
  for (const [type, value] of [
    ["TreeNode", [1, null, 2, 3]],
    ["NaryTreeNode", [1, null, 3, 2, 4, null, 5, 6]],
    ["TreeNode<str>", ["a(,)", "b", "c", null, 'quoted"value']],
    ["TreeNode<long>", ["9007199254740993", null, "9223372036854775807"]],
    ["NaryTreeNode<bool>", [true, null, false, false]],
  ] as const) {
    const source = formatNodeLiteral(type, [...value]);
    expect(parseNodeLiteral(type, source)).toEqual([...value]);
    expect(formatNodeLiteral(type, parseNodeLiteral(type, source))).toBe(source);
  }
  const nary = formatNodeLiteral("NaryTreeNode", [1, null, 3, 2, 4, null, 5, 6]);
  expect(nary).toBe("      1\n  (3, 2, 4)\n(5, 6) () ()");
  expect(nary.split("\n")).toHaveLength(3);
});

it("reads unaligned child groups and formats them deterministically", () => {
  const value = parseNodeLiteral("NaryTreeNode", "1\n(3,2,4)\n(5,6) () ()");
  expect(value).toEqual([1, null, 3, 2, 4, null, 5, 6]);
  expect(() => parseNodeLiteral("TreeNode", "1 (2,3,4)")).toThrow("two slots");
  expect(parseNodeLiteral("NaryTreeNode", "1 (null)")).toEqual([1]);
  expect(() => parseNodeLiteral("TreeNode", "1 () (2,3)")).toThrow("per parent");
  expect(() => parseNodeLiteral("TreeNode", '"unfinished')).toThrow();
});

it("translates preorder references to original breadth-first indices", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "select",
    nodeReferences: "return",
    parameters: [
      { name: "root", type: "TreeNode" },
      { name: "p", type: "TreeNode" },
    ],
    returnType: "TreeNode",
  };
  const args = [[1, 2, 3, null, 4], { ref: [0, 3] }];
  const context = { signature, args };
  expect(formatNodeLiteral("TreeNode", { ref: [0, 2] }, context)).toBe("root[4]");
  expect(parseNodeLiteral("TreeNode", "root[4]", context)).toEqual({ ref: [0, 2] });
  expect(() => parseNodeLiteral("TreeNode", "root[2]", context)).toThrow("existing node");
  const draft = createCustomDraft({
    signature,
    examples: [{ args, expected: { ref: [0, 2] } }],
  } as unknown as QuestionProblem);
  expect(draft.args[1]).toBe("root[3]");
  expect(draft.expected).toBe("root[4]");
  draft.expectedEnabled = true;
  expect(parseCustomDraft(draft, signature)).toEqual({ args, expected: { ref: [0, 2] } });
});

it("uses N-ary preorder and supports self-referencing list tails", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "root", type: "NaryTreeNode" }],
    returnType: "NaryTreeNode",
    nodeReferences: "return",
  };
  const args = [[1, null, 3, 2, 4, null, 5, 6]];
  expect(parseNodeLiteral("NaryTreeNode", "root[2]", { signature, args })).toEqual({ ref: [0, 4] });
  const list: Signature = {
    ...signature,
    parameters: [{ name: "head", type: "ListNode" }],
    returnType: "ListNode",
  };
  const context = { signature: list, sources: ["[1,2,2]->head[1]"] };
  expect(parseNodeLiteral("ListNode", context.sources[0], context)).toEqual({
    values: [1, 2, 2],
    tail: [0, 1],
  });
  expect(formatNodeLiteral("ListNode", { values: [1, 2, 2], tail: [0, 1] }, context)).toBe(
    "[1,2,2] -> head[1]",
  );
});

it("accepts missing child aliases inside groups and omits trailing leaf groups", () => {
  for (const source of ["1 (3, null)", "1 (3, _)", "1 (3,)", "1 (3)"])
    expect(parseNodeLiteral("TreeNode", source)).toEqual([1, 3]);
  expect(parseNodeLiteral("TreeNode", "1 (, 3)")).toEqual([1, null, 3]);
  for (const source of ["1 (3, _, 4)", "1 (3, null, 4)", "1 (3,,4)"])
    expect(parseNodeLiteral("NaryTreeNode", source)).toEqual([1, null, 3, 4]);
  expect(parseNodeLiteral("NaryTreeNode", "1 (3,2,4) (5,6)")).toEqual([
    1,
    null,
    3,
    2,
    4,
    null,
    5,
    6,
  ]);
  for (const source of ["1 (3,2,4) null (5,6)", "1 (3,2,4) _ (5,6)", "1 (3,2,4),,(5,6)"])
    expect(() => parseNodeLiteral("NaryTreeNode", source)).toThrow("parentheses");
});
