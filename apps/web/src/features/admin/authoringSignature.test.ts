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
