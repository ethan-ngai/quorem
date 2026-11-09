/** @file graph.test.ts @description Mixed graph encodings and native case fidelity. @module questions */
import { describe, expect, it } from "vitest";
import { GRAPH_RETURN, projectCaseGraphs, type QuestionGraph } from "./graph.ts";
import { normalizeQuestionDraft } from "./draft-normalize.ts";
import { validateQuestionDefinition } from "./publication.ts";
import { validateQuestionSchema } from "./schema-validation.ts";
import type { Signature } from "./model.ts";

const limits = {
  wallTimeMs: 2000,
  memoryBytes: 268435456,
  outputBytes: 65536,
  maxProcesses: 16,
  maxCollectionElements: 10000,
  maxNestingDepth: 100,
};
const line: QuestionGraph = { directed: false, nodes: [0, 1, 2], edges: [{ from: 0, to: 1 }] };
const weighted: QuestionGraph = {
  directed: true,
  nodes: [1, 2, 3],
  edges: [
    { from: 2, to: 1, value: 7 },
    { from: 2, to: 1, value: 3 },
  ],
};
const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [
    { name: "times", type: "list<list<int>>" },
    { name: "n", type: "int" },
    { name: "neighbors", type: "array<array<int>>" },
    { name: "encoded", type: "str" },
  ],
  returnType: "list<list<list<int>>>",
  graphEncodings: {
    times: { kind: "edgeList", countParameter: "n", firstNode: 1, edgeValue: "travel time" },
    neighbors: { kind: "adjacencyList", countParameter: "n" },
    encoded: { kind: "custom" },
    "$return[0]": { kind: "adjacencyMatrix", matrixDiagonal: 1 },
    "$return[1]": { kind: "edgeList" },
  },
};
const graphCase = {
  args: [null, null, null, "JFK-SFO"],
  graphs: {
    times: weighted,
    neighbors: line,
    encoded: { directed: true, nodes: ["JFK", "SFO"], edges: [{ from: "JFK", to: "SFO" }] },
    "$return[0]": line,
    "$return[1]": line,
  },
};
const content = {
  problem: {
    slug: "graph-case",
    title: "Graph case",
    statementMarkdown: "Return two graphs.",
    signature,
    examples: [graphCase],
    limits,
  },
  hiddenCases: [graphCase],
  attribution: "Fixture",
};
const normalize = (value: unknown) => normalizeQuestionDraft(JSON.stringify(value));

describe("authored graphs", () => {
  it("compiles mixed input and return encodings without changing custom inputs", () => {
    const raw = normalize(content);
    validateQuestionDefinition(raw, validateQuestionSchema, true);
    expect(normalizeQuestionDraft(raw)).toBe(raw);
    const test = JSON.parse(raw).problem.examples[0];
    expect(test.args).toEqual([
      [
        [2, 1, 7],
        [2, 1, 3],
      ],
      3,
      [[1], [0], []],
      "JFK-SFO",
    ]);
    expect(test.expected).toEqual([
      [
        [1, 1, 0],
        [1, 1, 0],
        [0, 0, 1],
      ],
      [[0, 1]],
    ]);
    expect(test.graphs).toEqual(graphCase.graphs);
  });

  it("rejects conflicts, topology errors, and missing custom graphs", () => {
    expect(() =>
      normalize({
        ...content,
        hiddenCases: [{ ...graphCase, args: [null, 4, null, "JFK-SFO"] }],
      }),
    ).toThrow("Graph conflicts with n");
    expect(() =>
      projectCaseGraphs(signature, {
        times: weighted,
        neighbors: { ...line, nodes: [0, 1] },
      }),
    ).toThrow("sharing a node count");
    expect(() =>
      projectCaseGraphs(signature, {
        neighbors: { ...line, edges: [{ from: 0, to: 4 }] },
      }),
    ).toThrow("existing endpoints");
    const raw = normalize({
      ...content,
      hiddenCases: [{ ...graphCase, graphs: { ...graphCase.graphs, encoded: undefined } }],
    });
    expect(() => validateQuestionDefinition(raw, validateQuestionSchema, true)).toThrow(
      "Custom graph encoded",
    );
  });

  it("encodes successor and parent arrays with the original missing-value sentinel", () => {
    const indexed: Signature = {
      ...signature,
      parameters: [{ name: "next", type: "list<int>" }],
      returnType: "array<int>",
      graphEncodings: { next: { kind: "successor" }, [GRAPH_RETURN]: { kind: "parent" } },
    };
    const output = projectCaseGraphs(indexed, {
      next: { ...line, directed: true },
      [GRAPH_RETURN]: {
        ...line,
        edges: [
          { from: 1, to: 0 },
          { from: 2, to: 0 },
        ],
      },
    });
    expect(output.args.get(0)).toEqual([1, -1, -1]);
    expect(output.expected).toEqual([-1, 0, 0]);
  });
});
