/** @file graphFixtures.ts @description Editable local fixtures for graph authoring and solver previews. @module dev */
import type { QuestionContent, Signature } from "@quorem/contracts";
import { normalizeQuestionDraft, type QuestionGraph } from "@quorem/questions";

type Case = QuestionContent["problem"]["examples"][number];
type Fixture = {
  id: string;
  title: string;
  hint: string;
  parameters: Signature["parameters"];
  returnType: string;
  graphEncodings?: Signature["graphEncodings"];
  examples: Case[];
  hiddenCases?: Case[];
};

const pairs = "list<list<int>>";
const path = {
  directed: true,
  nodes: [0, 1, 2],
  edges: [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ],
} satisfies QuestionGraph;
const sparse = { ...path, edges: [{ from: 0, to: 2 }] } satisfies QuestionGraph;
const roadCase: Case = {
  args: [
    [
      [2, 1, 7],
      [2, 3, 4],
      [3, 4, 2],
    ],
    5,
    2,
  ],
  expected: -1,
};

export const graphFixtures: readonly Fixture[] = [
  {
    id: "weighted",
    title: "Weighted edge list",
    hint: "Opens directly from the saved array. Focus a weight to highlight its edge. Node 5 is isolated. Add a row and paste two tab-separated edge rows, or clear a weight to see validation and the last valid solver input.",
    parameters: [
      { name: "times", type: pairs },
      { name: "n", type: "int" },
      { name: "start", type: "int" },
    ],
    returnType: "int",
    graphEncodings: {
      times: {
        kind: "edgeList",
        directed: true,
        countParameter: "n",
        firstNode: 1,
        edgeValue: "Weight",
      },
    },
    examples: [
      roadCase,
      {
        args: [
          [
            [1, 2, 8],
            [1, 2, 3],
            [2, 3, 1],
          ],
          3,
          1,
        ],
        expected: 4,
      },
    ],
    hiddenCases: [{ args: [[], 1, 1], expected: 0 }],
  },
  {
    id: "two-inputs",
    title: "Two graphs with a shared node count",
    hint: "One undirected edge list and one directed adjacency list both generate n. Change the node count in both graphs to resolve the conflict. Solver preview displays both diagrams.",
    parameters: [
      { name: "roads", type: pairs },
      { name: "neighbors", type: pairs },
      { name: "n", type: "int" },
    ],
    returnType: "bool",
    graphEncodings: {
      roads: { kind: "edgeList", directed: false, countParameter: "n" },
      neighbors: { kind: "adjacencyList", directed: true, countParameter: "n" },
    },
    examples: [
      {
        args: [
          [
            [0, 1],
            [1, 2],
          ],
          [[2, 1], [], [1], []],
          4,
        ],
        expected: true,
      },
    ],
  },
  {
    id: "matrix",
    title: "Adjacency matrix and native fallback",
    hint: "Case 1 converts an undirected matrix with ones on the diagonal. Case 2 stays editable as a native matrix because its asymmetric entries cannot round-trip through that preset.",
    parameters: [{ name: "connected", type: pairs }],
    returnType: "int",
    graphEncodings: { connected: { kind: "adjacencyMatrix", directed: false, matrixDiagonal: 1 } },
    examples: [
      {
        args: [
          [
            [1, 1, 0],
            [1, 1, 0],
            [0, 0, 1],
          ],
        ],
        expected: 2,
      },
      {
        args: [
          [
            [1, 1, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        ],
        expected: 2,
      },
    ],
  },
  {
    id: "indexed",
    title: "Successor and parent arrays",
    hint: "Compare the directed next-node array and child-to-parent array. The solver preview keeps -1 for entries with no next node or parent.",
    parameters: [
      { name: "next", type: "list<int>" },
      { name: "parent", type: "list<int>" },
    ],
    returnType: "int",
    graphEncodings: { next: { kind: "successor" }, parent: { kind: "parent" } },
    examples: [
      {
        args: [
          [1, 2, -1],
          [-1, 0, 0],
        ],
        expected: 3,
      },
    ],
  },
  {
    id: "whole-return",
    title: "Graph as the whole return value",
    hint: "The expected graph generates the entire solver output. Edit the return graph while keeping the source edges as an ordinary native input.",
    parameters: [{ name: "edges", type: pairs }],
    returnType: pairs,
    graphEncodings: { $return: { kind: "adjacencyList", directed: true } },
    examples: [
      {
        args: [
          [
            [0, 1],
            [1, 2],
          ],
        ],
        expected: [[1], [2], []],
      },
    ],
  },
  {
    id: "return-slots",
    title: "Multiple graph output slots",
    hint: "One return slot generates a matrix and the other an edge list. In Solver preview, both expected graphs appear below the output while the input graph stays alongside.",
    parameters: [
      { name: "roads", type: pairs },
      { name: "n", type: "int" },
    ],
    returnType: "list<list<list<int>>>",
    graphEncodings: {
      roads: { kind: "edgeList", directed: true, countParameter: "n", edgeValue: "Weight" },
      "$return[0]": { kind: "adjacencyMatrix", directed: true },
      "$return[1]": { kind: "edgeList", directed: true },
    },
    examples: [
      {
        args: [
          [
            [0, 1, 7],
            [0, 2, 4],
            [2, 1, 2],
          ],
          3,
        ],
        expected: [
          [
            [0, 1, 1],
            [0, 0, 0],
            [0, 1, 0],
          ],
          [
            [0, 2],
            [2, 1],
          ],
        ],
      },
    ],
  },
  {
    id: "custom",
    title: "Custom graph with typed values",
    hint: "Open Node values to edit station coordinates. The edge value is boolean, independent of the node value type. The concrete route text stays editable. Try an invalid edge value to see type feedback.",
    parameters: [{ name: "route", type: "str" }],
    returnType: "str",
    graphEncodings: {
      route: { kind: "custom", directed: true, nodeValueType: "list<int>", edgeValueType: "bool" },
      $return: { kind: "custom", directed: true, edgeValueType: "str" },
    },
    examples: [
      {
        args: ["JFK>SFO;SFO>SEA"],
        expected: "JFK>SEA",
        graphs: {
          route: {
            directed: true,
            nodes: [
              { id: "JFK", value: [40, -73] },
              { id: "SFO", value: [37, -122] },
              { id: "SEA", value: [47, -122] },
            ],
            edges: [
              { from: "JFK", to: "SFO", value: true },
              { from: "SFO", to: "SEA", value: false },
            ],
          },
          $return: {
            directed: true,
            nodes: ["JFK", "SEA"],
            edges: [{ from: "JFK", to: "SEA", value: "direct" }],
          },
        },
      },
    ],
  },
  {
    id: "direction",
    title: "Signature direction and empty graph",
    hint: "In Signature, change Direction under Graphs. All cases follow that setting. The second case starts from native values, and the third shows the empty graph state.",
    parameters: [
      { name: "edges", type: pairs },
      { name: "n", type: "int" },
    ],
    returnType: "bool",
    graphEncodings: { edges: { kind: "edgeList", directed: true, countParameter: "n" } },
    examples: [
      { args: [null, null], expected: true, graphs: { edges: path } },
      { args: [[[0, 2]], 3], expected: true },
      {
        args: [null, null],
        expected: false,
        graphs: { edges: { ...sparse, nodes: [], edges: [] } },
      },
    ],
  },
  {
    id: "add-binding",
    title: "Start with a native case",
    hint: "In Signature, open Graphs and use Add graph to bind edges. Set n as the node count, then return to Tests. The graph editor opens from the original values and preserves the isolated node. Switch to Successor array in Signature to see the parameter type and solver input update.",
    parameters: [
      { name: "edges", type: pairs },
      { name: "n", type: "int" },
    ],
    returnType: "bool",
    examples: [{ args: [[[0, 1]], 3], expected: false }],
  },
  {
    id: "large",
    title: "Large edge table and bounded diagram",
    hint: "Use the edge page controls. The graph exceeds the diagram limit, so the preview shows a node and edge count while the generated solver array remains available.",
    parameters: [
      { name: "edges", type: pairs },
      { name: "n", type: "int" },
    ],
    returnType: "int",
    graphEncodings: { edges: { kind: "edgeList", directed: true, countParameter: "n" } },
    examples: [{ args: [Array.from({ length: 39 }, (_, i) => [i, i + 1]), 40], expected: 40 }],
  },
];

export function fixtureQuestion(fixture: Fixture): QuestionContent {
  return JSON.parse(
    normalizeQuestionDraft(
      JSON.stringify({
        problem: {
          slug: `graph-${fixture.id}`,
          title: fixture.title,
          statementMarkdown: fixture.hint,
          signature: {
            className: "Solution",
            methodName: "solve",
            parameters: fixture.parameters,
            returnType: fixture.returnType,
            graphEncodings: fixture.graphEncodings,
          },
          examples: fixture.examples,
        },
        hiddenCases: fixture.hiddenCases ?? [],
        attribution: "Local graph demo",
      }),
    ),
  ) as QuestionContent;
}
