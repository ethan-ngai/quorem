/** @file graph.test.ts @description Mixed graph encodings and native case fidelity. @module questions */
import { describe, expect, it } from "vitest";
import {
  GRAPH_RETURN,
  GRAPH_RETURN_LIST,
  caseGraphTargets,
  compileGraphCase,
  inferCaseGraph,
  projectCaseGraphs,
  type QuestionGraph,
} from "./graph.ts";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";
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

it("recovers ordered native edges and isolated nodes without guessing direction", () => {
  const sig: Signature = {
    ...signature,
    graphEncodings: {
      times: {
        kind: "edgeList",
        directed: true,
        countParameter: "n",
        firstNode: 1,
        edgeValue: "time",
      },
    },
  };
  const args = [
    [
      [2, 1, 7],
      [2, 1, 3],
    ],
    3,
  ];
  expect(inferCaseGraph(sig, "times", args, undefined, 20)).toEqual(weighted);
  expect(inferCaseGraph(sig, "times", [args[0], 1], undefined, 20)).toBeUndefined();
  expect(
    inferCaseGraph(
      { ...sig, graphEncodings: { times: { kind: "edgeList", edgeValue: "time" } } },
      "times",
      args,
      undefined,
      20,
    ),
  ).toBeUndefined();
});

it("preserves the native matrix and declines to normalize asymmetric undirected data", () => {
  const sig: Signature = {
    ...signature,
    graphEncodings: {
      "$return[0]": { kind: "adjacencyMatrix", directed: false, matrixDiagonal: 1 },
    },
  };
  expect(
    inferCaseGraph(
      sig,
      "$return[0]",
      [],
      [
        [
          [1, 1, 0],
          [1, 1, 0],
          [0, 0, 1],
        ],
      ],
      20,
    ),
  ).toEqual(line);
  expect(
    inferCaseGraph(
      sig,
      "$return[0]",
      [],
      [
        [
          [1, 1, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      ],
      20,
    ),
  ).toBeUndefined();
});

it("validates independent node and edge payload types while connecting by stable ID", () => {
  const sig: Signature = {
    ...signature,
    graphEncodings: {
      encoded: { kind: "custom", nodeValueType: "list<int>", edgeValueType: "bool" },
    },
  };
  const graph: QuestionGraph<number[], boolean> = {
    directed: true,
    nodes: [
      { id: "A", value: [7, 3] },
      { id: "B", value: [7, 3] },
    ],
    edges: [{ from: "A", to: "B", value: false }],
  };
  expect(projectCaseGraphs(sig, { encoded: graph }).args.size).toBe(0);
  const native = {
    args: [[[2, 1, 7]], 3, [[1], [0], []], "A-B"],
    expected: [],
    graphs: { encoded: graph },
  };
  const raw = normalize({
    ...content,
    problem: { ...content.problem, signature: sig, examples: [native] },
    hiddenCases: [native],
  });
  validateQuestionDefinition(raw, validateQuestionSchema, true);
  expect(JSON.parse(raw).problem.examples[0].graphs.encoded).toEqual(graph);
  expect(() =>
    projectCaseGraphs(sig, { encoded: { ...graph, edges: [{ ...graph.edges[0]!, value: 1 }] } }),
  ).toThrow(/Edge value \(bool\)/);
  expect(() =>
    projectCaseGraphs(sig, {
      encoded: { ...graph, nodes: [{ id: "A", value: ["7"] }, graph.nodes[1]!] },
    }),
  ).toThrow(/Node value \(list<int>\)/);
});

it("keeps typed node payloads separate from preset solver IDs", () => {
  const sig: Signature = {
    ...signature,
    graphEncodings: { times: { kind: "edgeList", edgeValue: "Weight", nodeValueType: "str" } },
  };
  const graph: QuestionGraph<string, number> = {
    directed: true,
    nodes: [
      { id: 1, value: "start" },
      { id: 2, value: "finish" },
    ],
    edges: [{ from: 1, to: 2, value: 4 }],
  };
  expect(projectCaseGraphs(sig, { times: graph }).args.get(0)).toEqual([[1, 2, 4]]);
});

it("compiles return lists of different lengths with one representation", () => {
  const sig: Signature = {
    ...signature,
    parameters: [],
    graphEncodings: {
      [GRAPH_RETURN_LIST]: { kind: "edgeList", directed: false },
    },
  };
  expect(caseGraphTargets(sig, [])).toEqual([]);
  const test = parseLosslessJson(
    JSON.stringify({
      args: [],
      graphs: { "$return[0]": line, "$return[1]": line, "$return[2]": line },
    }),
  ) as Record<string, JsonValue>;
  compileGraphCase(sig, test, 100, true);
  const expected = [[[0, 1]], [[0, 1]], [[0, 1]]];
  expect(JSON.parse(stringifyLosslessJson(test.expected!))).toEqual(expected);
  expect(caseGraphTargets(sig, expected)).toEqual(["$return[0]", "$return[1]", "$return[2]"]);
  expect(inferCaseGraph(sig, "$return[1]", [], expected, 100)?.edges).toEqual(line.edges);
  expect(() => compileGraphCase(sig, { args: [], expected: [] }, 100, true)).not.toThrow();
  const mixed: Signature = {
    ...sig,
    graphEncodings: { ...sig.graphEncodings, "$return[1]": { kind: "adjacencyList" } },
  };
  expect(() => projectCaseGraphs(mixed, { "$return[0]": line })).toThrow("one representation");
});
