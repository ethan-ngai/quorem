/** @file graphFixtures.ts @description Editable local fixtures for graph authoring and solver previews. @module dev */
import type { QuestionContent, Signature } from "@quorem/contracts";
import {
  GRAPH_RETURN,
  graphPresetType,
  graphReturnSlot,
  normalizeQuestionDraft,
  type QuestionGraph,
} from "@quorem/questions";

type Case = QuestionContent["problem"]["examples"][number];
type Fixture = {
  id: string;
  title: string;
  hint: string;
  parameters: (Omit<Signature["parameters"][number], "type"> & { type?: string })[];
  returnType?: string;
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
const directedExamples: Case[] = [
  { args: [null, null], expected: true, graphs: { edges: path } },
  { args: [null, null], expected: true, graphs: { edges: sparse } },
  {
    args: [null, null],
    expected: false,
    graphs: { edges: { directed: true, nodes: [], edges: [] } },
  },
];
const directedHiddenCases: Case[] = [
  {
    args: [null, null],
    expected: false,
    graphs: { edges: { ...path, edges: [{ from: 2, to: 1 }] } },
  },
];
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
    parameters: [{ name: "times" }, { name: "n", type: "int" }, { name: "start", type: "int" }],
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
    parameters: [{ name: "roads" }, { name: "neighbors" }, { name: "n", type: "int" }],
    returnType: "bool",
    graphEncodings: {
      roads: { kind: "edgeList", directed: false, countParameter: "n" },
      neighbors: { kind: "adjacencyList", directed: true, countParameter: "n" },
    },
    examples: [
      {
        args: [null, null, null],
        graphs: {
          roads: { ...path, directed: false, nodes: [0, 1, 2, 3] },
          neighbors: {
            directed: true,
            nodes: [0, 1, 2, 3],
            edges: [
              { from: 0, to: 2 },
              { from: 0, to: 1 },
              { from: 2, to: 1 },
            ],
          },
        },
        expected: true,
      },
    ],
  },
  {
    id: "matrix",
    title: "Adjacency matrix and native fallback",
    hint: "Case 1 converts an undirected matrix with ones on the diagonal. Case 2 stays editable as a native matrix because its asymmetric entries cannot round-trip through that preset.",
    parameters: [{ name: "connected" }],
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
    parameters: [{ name: "next" }, { name: "parent" }],
    returnType: "int",
    graphEncodings: { next: { kind: "successor" }, parent: { kind: "parent" } },
    examples: [
      {
        args: [null, null],
        graphs: {
          next: path,
          parent: {
            directed: false,
            nodes: [0, 1, 2],
            edges: [
              { from: 1, to: 0 },
              { from: 2, to: 0 },
            ],
          },
        },
        expected: 3,
      },
    ],
  },
  {
    id: "whole-return",
    title: "Graph as the whole return value",
    hint: "The expected graph generates the entire solver output. Edit the return graph while keeping the source edges as an ordinary native input.",
    parameters: [{ name: "edges", type: pairs }],
    graphEncodings: { $return: { kind: "adjacencyList", directed: true } },
    examples: [
      {
        args: [
          [
            [0, 1],
            [1, 2],
          ],
        ],
        expected: null,
        graphs: { $return: path },
      },
    ],
  },
  {
    id: "return-slots",
    title: "Multiple graph output slots",
    hint: "One return slot generates a matrix and the other an edge list. In Solver preview, both expected graphs appear below the output while the input graph stays alongside.",
    parameters: [{ name: "roads" }, { name: "n", type: "int" }],
    graphEncodings: {
      roads: { kind: "edgeList", directed: true, countParameter: "n", edgeValue: "Weight" },
      "$return[0]": { kind: "adjacencyMatrix", directed: true },
      "$return[1]": { kind: "edgeList", directed: true },
    },
    examples: [
      {
        args: [null, null],
        expected: null,
        graphs: {
          roads: {
            ...path,
            edges: [
              { from: 0, to: 1, value: 7 },
              { from: 0, to: 2, value: 4 },
              { from: 2, to: 1, value: 2 },
            ],
          },
          "$return[0]": {
            ...path,
            edges: [
              { from: 0, to: 1 },
              { from: 0, to: 2 },
              { from: 2, to: 1 },
            ],
          },
          "$return[1]": {
            ...path,
            edges: [
              { from: 0, to: 2 },
              { from: 2, to: 1 },
            ],
          },
        },
      },
    ],
  },
  {
    id: "custom",
    title: "Custom graph with typed values",
    hint: "In Signature, open the route gear to set Node value type and Edge value type directly. In Tests, edit station coordinates and boolean edge values. The solver gets the manually authored route text.",
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
    hint: "These cases generate an edge list from the saved graphs. Compare Signature and Tests with the Successor array fixture, which uses the same graphs. Change Direction in Graph settings to update the diagrams.",
    parameters: [{ name: "edges" }, { name: "n", type: "int" }],
    returnType: "bool",
    graphEncodings: { edges: { kind: "edgeList", directed: true, countParameter: "n" } },
    examples: directedExamples,
    hiddenCases: directedHiddenCases,
  },
  {
    id: "successor-comparison",
    title: "Same graph as a successor array",
    hint: "The graphs from Signature direction and empty graph now generate list<int> inputs. Compare the public and private cases. An entry of -1 means a node has no successor.",
    parameters: [{ name: "edges" }, { name: "n", type: "int" }],
    returnType: "bool",
    graphEncodings: { edges: { kind: "successor", countParameter: "n" } },
    examples: directedExamples,
    hiddenCases: directedHiddenCases,
  },
  {
    id: "add-binding",
    title: "Start with a native case",
    hint: "In Signature, choose Graph as the type for edges. Open its Graph settings. Set n as the node count, then return to Tests. The graph editor opens from the original values and preserves the isolated node. In Graph settings, switch to Successor array to see the parameter type and solver input update.",
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
    parameters: [{ name: "edges" }, { name: "n", type: "int" }],
    returnType: "int",
    graphEncodings: { edges: { kind: "edgeList", directed: true, countParameter: "n" } },
    examples: [
      {
        args: [null, null],
        expected: 40,
        graphs: {
          edges: {
            directed: true,
            nodes: Array.from({ length: 40 }, (_, i) => i),
            edges: Array.from({ length: 39 }, (_, i) => ({ from: i, to: i + 1 })),
          },
        },
      },
    ],
  },
];

export function fixtureQuestion(fixture: Fixture): QuestionContent {
  const encodings = fixture.graphEncodings ?? {};
  function presetType(target: string) {
    const encoding = encodings[target];
    return encoding && graphPresetType(encoding.kind);
  }
  function requireType(type: string | undefined, target: string) {
    if (!type) throw new Error(`Fixture ${fixture.id} needs a solver type for ${target}.`);
    return type;
  }
  const slotType = Object.keys(encodings)
    .filter((target) => graphReturnSlot(target) !== undefined)
    .map(presetType)
    .find(Boolean);
  const returnType =
    presetType(GRAPH_RETURN) ?? (slotType ? `list<${slotType}>` : fixture.returnType);
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
            parameters: fixture.parameters.map(({ name, type, ...parameter }) => ({
              ...parameter,
              name,
              type: requireType(presetType(name) ?? type, name),
            })),
            returnType: requireType(returnType, GRAPH_RETURN),
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
