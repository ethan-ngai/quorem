/** @file nodeDiagram.test.ts @description Preview topology preserves judge identities and preorder selectors. @module editor */
import { expect, it } from "vitest";
import { buildNodeDiagram, buildCaseDiagram } from "./nodeDiagram";
import type { Signature } from "@quorem/contracts";
it("preserves binary holes and preorder indices", () => {
  const graph = buildNodeDiagram("TreeNode", [1, 2, 3, null, 4], undefined, "root");
  expect(graph.nodes.find((node) => node.label === "4")?.reference).toBe("root[3]");
  expect(graph.nodes.find((node) => node.missing)?.reference).toBeUndefined();
  expect(graph.edges).toHaveLength(4);
});
it("renders shared list nodes once and connects cycles without traversal", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [
      { name: "a", type: "ListNode" },
      { name: "b", type: "ListNode" },
    ],
    returnType: "ListNode",
    nodeReferences: "return",
  };
  const args = [
    { values: [1, 2, 3], tail: [0, 1] },
    { values: [4], tail: [0, 2] },
  ];
  const graph = buildNodeDiagram("ListNode", { ref: [0, 2] }, { signature, args });
  expect(graph.nodes).toHaveLength(4);
  expect(graph.edges.filter((edge) => edge.tail)).toEqual([
    { from: "0:2", to: "0:1", tail: true },
    { from: "1:0", to: "0:2", tail: true },
  ]);
  expect(graph.selected).toBe("0:2");
});
it("names aliases and translates N-ary preorder references", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [
      { name: "root", type: "NaryTreeNode" },
      { name: "p", type: "NaryTreeNode" },
    ],
    returnType: "NaryTreeNode",
    nodeReferences: "return",
  };
  const args = [[1, null, 3, 2, 4, null, 5, 6], { ref: [0, 4] }];
  const graph = buildNodeDiagram("NaryTreeNode", args[1], { signature, args }, "p");
  expect(graph.nodes.find((node) => node.label === "5")).toMatchObject({
    reference: "root[2]",
    names: ["p"],
  });
  expect(graph.nodes).toHaveLength(6);
});

it("combines optional trees, lists and output references without duplicating inputs", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [
      { name: "root", type: "optional<TreeNode>" },
      { name: "head", type: "ListNode" },
      { name: "p", type: "TreeNode" },
    ],
    returnType: "TreeNode",
    nodeReferences: "return",
  };
  const graph = buildCaseDiagram(
    { signature, args: [[1, 2, 3], [9, 8], { ref: [0, 1] }] },
    { ref: [0, 1] },
    { ref: [0, 2] },
  );
  expect(graph.outputMatchesExpected).toBe(false);
  expect(graph.nodes).toHaveLength(5);
  expect(graph.groups).toHaveLength(2);
  expect(graph.nodes.find((node) => node.id === "0:1")).toMatchObject({
    names: ["p"],
    outputs: ["expected"],
  });
  expect(graph.nodes.find((node) => node.id === "0:2")?.outputs).toEqual(["actual"]);
  expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(5);
});
it("retains valid input structures while another literal is incomplete", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [
      { name: "a", type: "TreeNode" },
      { name: "b", type: "TreeNode" },
    ],
    returnType: "int",
  };
  const graph = buildCaseDiagram({ signature, sources: ["1\n(2, 3)", "1\n("] });
  expect(graph.nodes).toHaveLength(3);
  expect(graph.roots).toEqual(["0:0"]);
});

it("retains both output roles on a shared target", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "Expected", type: "TreeNode" }],
    returnType: "TreeNode",
    nodeReferences: "return",
  };
  const graph = buildCaseDiagram({ signature, args: [[1]] }, { ref: [0, 0] }, { ref: [0, 0] });
  expect(graph.outputMatchesExpected).toBe(true);
  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0]).toMatchObject({ names: ["Expected"], outputs: ["expected", "actual"] });
});

it("compares structural outputs and leaves unchecked outputs neutral", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [],
    returnType: "TreeNode",
  };
  const context = { signature, args: [] };
  expect(buildCaseDiagram(context, [1, 2], [1, 2]).outputMatchesExpected).toBe(true);
  expect(buildCaseDiagram(context, [1, 2], [1, 3]).outputMatchesExpected).toBe(false);
  expect(buildCaseDiagram(context, null, [1]).outputMatchesExpected).toBe(false);
  expect(buildCaseDiagram(context, undefined, [1]).outputMatchesExpected).toBeUndefined();
});

it.each(["TreeNode", "NaryTreeNode", "ListNode"])(
  "represents empty %s inputs without creating a reference target",
  (type) => {
    const signature: Signature = {
      className: "Solution",
      methodName: "f",
      parameters: [{ name: "root", type }],
      returnType: "int",
    };
    for (const value of [null, []]) {
      const graph = buildCaseDiagram({ signature, args: [value] });
      expect(graph.nodes).toEqual([
        {
          id: "0:empty",
          type,
          label: "∅",
          names: ["root"],
          missing: false,
          empty: true,
          children: [],
        },
      ]);
      expect(graph.roots).toEqual(["0:empty"]);
      expect(graph.edges).toEqual([]);
    }
  },
);
it("retains an empty input beside a real tree and identifies null outputs", () => {
  const signature: Signature = {
    className: "Solution",
    methodName: "f",
    parameters: [
      { name: "root", type: "TreeNode" },
      { name: "other", type: "TreeNode" },
    ],
    returnType: "TreeNode",
    nodeReferences: "return",
  };
  const context = { signature, args: [null, [1]] };
  const mismatch = buildCaseDiagram(context, { ref: [1, 0] }, null);
  expect(mismatch.nodes.find((node) => node.id === "0:empty")?.empty).toBe(true);
  expect(mismatch.nodes.find((node) => node.outputs?.includes("expected"))?.id).toBe("1:0");
  expect(mismatch.nodes.find((node) => node.outputs?.includes("actual"))?.empty).toBe(true);
  expect(mismatch.outputMatchesExpected).toBe(false);
  const match = buildCaseDiagram(context, [], null);
  expect(match.outputMatchesExpected).toBe(true);
  expect(match.nodes.filter((node) => node.outputs?.length)).toHaveLength(1);
  expect(match.nodes.find((node) => node.outputs?.length)?.outputs).toEqual(["expected", "actual"]);
});
