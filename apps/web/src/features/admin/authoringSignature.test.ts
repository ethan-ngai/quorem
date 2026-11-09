import { GRAPH_RETURN, primarySignature } from "@quorem/questions";
import { expect, it } from "vitest";
import { adaptSignature } from "./authoringSignature";
import { blankQuestion } from "./content";
it("adapts public and private case arity before shared test controls receive a signature", () => {
  const content = blankQuestion();
  content.problem.examples = [{ args: [], expected: 1, explanation: "Keep explanation" }];
  content.hiddenCases = [{ args: [], expected: 1 }];
  const signature = {
    ...primarySignature(content.problem),
    parameters: [{ name: "n", type: "int" }],
  };
  const next = adaptSignature(content, signature);
  expect(next.problem.examples[0]).toEqual({
    args: [0],
    expected: 1,
    explanation: "Keep explanation",
  });
  expect(next.hiddenCases[0]?.args).toEqual([0]);
  const renamed = adaptSignature(next, {
    ...signature,
    methodName: "renamed",
    parameters: [{ name: "renamed", type: "int" }],
  });
  expect(renamed.problem.examples).toEqual(next.problem.examples);
});

it("reprojects public and private native graph cases when their preset changes type", () => {
  const content = blankQuestion();
  const signature = {
    ...primarySignature(content.problem),
    parameters: [{ name: "next", type: "list<int>" }],
    returnType: "list<int>",
    graphEncodings: {
      next: { kind: "successor" as const },
      [GRAPH_RETURN]: { kind: "parent" as const },
    },
  };
  const test = { args: [[1, -1, -1]], expected: [-1, 0, -1] };
  content.problem.signature = signature;
  content.problem.examples = [test];
  content.hiddenCases = [test];

  const updated = adaptSignature(content, {
    ...signature,
    parameters: [{ name: "next", type: "list<list<int>>" }],
    returnType: "list<list<int>>",
    graphEncodings: {
      next: { kind: "adjacencyList", directed: true },
      [GRAPH_RETURN]: { kind: "edgeList", directed: false },
    },
  });
  const expected = { args: [[[1], [], []]], expected: [[1, 0]] };
  expect(updated.problem.examples[0]).toMatchObject(expected);
  expect(updated.hiddenCases[0]).toMatchObject(expected);
});

it("removes edge weights from native public and private cases", () => {
  const content = blankQuestion();
  const encoding = { kind: "edgeList", directed: true, edgeValue: "Weight" } as const;
  const signature = {
    ...primarySignature(content.problem),
    parameters: [{ name: "roads", type: "list<list<int>>" }],
    graphEncodings: { roads: encoding },
  };
  const test = {
    args: [
      [
        [0, 1, 5],
        [0, 1, 7],
      ],
    ],
    expected: 1,
  };
  content.problem.signature = signature;
  content.problem.examples = [test];
  content.hiddenCases = [test];

  const updated = adaptSignature(content, {
    ...signature,
    graphEncodings: { roads: { ...encoding, edgeValue: undefined } },
  });

  for (const entry of [updated.problem.examples[0], updated.hiddenCases[0]]) {
    expect(entry?.args).toEqual([
      [
        [0, 1],
        [0, 1],
      ],
    ]);
    expect(entry?.graphs?.roads?.edges).toEqual([
      { from: 0, to: 1 },
      { from: 0, to: 1 },
    ]);
  }
});

it("keeps graph bindings and case values at their original positions when names are swapped", () => {
  const content = blankQuestion();
  const signature = {
    ...primarySignature(content.problem),
    parameters: [
      { name: "edges", type: "list<list<int>>" },
      { name: "n", type: "int" },
    ],
    graphEncodings: { edges: { kind: "edgeList" as const, countParameter: "n" } },
  };
  content.problem.signature = signature;
  const graph = { directed: false, nodes: [0, 1, 2], edges: [{ from: 0, to: 1 }] };
  const test = { args: [[[0, 1]], 3], expected: 1, graphs: { edges: graph } };
  content.problem.examples = [test];
  content.hiddenCases = [test];

  const updated = adaptSignature(content, {
    ...signature,
    parameters: [
      { name: "n", type: "list<list<int>>" },
      { name: "edges", type: "int" },
    ],
  });

  expect(updated.problem.signature?.graphEncodings).toEqual({
    n: { kind: "edgeList", countParameter: "edges" },
  });
  const renamed = { ...test, graphs: { n: graph } };
  expect(updated.problem.examples).toEqual([renamed]);
  expect(updated.hiddenCases).toEqual([renamed]);
});
