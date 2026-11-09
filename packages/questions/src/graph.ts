/** @file graph.ts @description Graph authoring model and native argument projection. @module questions */
import type { components, WireValue } from "@quorem/contracts/schema";
import { parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";
import type { Signature } from "./model.ts";

export type QuestionGraph = components["schemas"]["QuestionGraph"];
export type GraphEncoding = components["schemas"]["GraphEncoding"];
export const GRAPH_RETURN = "$return";
export function graphReturnSlot(target: string): number | undefined {
  const match = /^\$return\[(0|[1-9][0-9]{0,4})\]$/.exec(target);
  return match ? Number(match[1]) : undefined;
}
export const isGraphReturn = (target: string) =>
  target === GRAPH_RETURN || graphReturnSlot(target) !== undefined;
export type CaseGraphs = Record<string, QuestionGraph>;
const label = (v: unknown) =>
  int(v) || (typeof v === "string" && v.length > 0 && v.length <= 120 && !v.includes("\0"));
const int = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;

/** Check topology before it can be projected or rendered. */
export function validateGraph(graph: QuestionGraph, limit: number): void {
  if (
    !graph ||
    typeof graph.directed !== "boolean" ||
    Object.keys(graph).some((key) => !["directed", "nodes", "edges"].includes(key)) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    graph.nodes.length + graph.edges.length > limit
  )
    throw new Error("Graph requires direction, nodes and edges within the collection limit");
  const nodes = new Set(graph.nodes);
  if (nodes.size !== graph.nodes.length || !graph.nodes.every(label))
    throw new Error("Graph node labels must be unique integer or text labels");
  for (const edge of graph.edges)
    if (
      !edge ||
      Object.keys(edge).some((key) => !["from", "to", "value"].includes(key)) ||
      !nodes.has(edge.from) ||
      !nodes.has(edge.to) ||
      (edge.value !== undefined && !label(edge.value) && !Number.isFinite(edge.value))
    )
      throw new Error(
        "Graph edges require existing endpoints and an optional number or text value",
      );
}

/** Map the graph and optional node count onto typed solver parameters. */
export function graphParameters(
  signature: Signature,
  target: string,
  encoding: GraphEncoding,
): { arg: number; count: number } | undefined {
  const slot = graphReturnSlot(target);
  const output = isGraphReturn(target);
  const returnType = signature.returnType.replaceAll("array<", "list<");
  if (
    slot !== undefined &&
    (!returnType.startsWith("list<") ||
      signature.outputOrder === "unordered" ||
      Object.hasOwn(signature.graphEncodings ?? {}, GRAPH_RETURN))
  )
    throw new Error(
      "Graph return slots require an ordered collection and no whole-return encoding",
    );
  const arg = signature.parameters.findIndex(({ name }) => name === target);
  if (!encoding || typeof encoding !== "object") throw new Error("Invalid graph encoding");
  if (!output && arg < 0) throw new Error(`Unknown graph argument ${target}`);
  if (output && signature.nodeReferences === "return" && encoding.kind !== "custom")
    throw new Error("Graph reference returns require a custom encoding");
  if (encoding.kind === "custom") {
    if (Object.keys(encoding).length !== 1)
      throw new Error("Custom graphs supply their own arguments");
    return;
  }
  if (
    !["edgeList", "adjacencyList", "adjacencyMatrix", "successor", "parent"].includes(
      encoding.kind,
    ) ||
    (encoding.edgeValue !== undefined &&
      (encoding.kind !== "edgeList" || !encoding.edgeValue.trim())) ||
    (encoding.firstNode !== undefined && encoding.firstNode !== 0 && encoding.firstNode !== 1) ||
    (encoding.matrixDiagonal !== undefined &&
      (encoding.kind !== "adjacencyMatrix" || ![0, 1].includes(encoding.matrixDiagonal)))
  )
    throw new Error("Invalid graph preset settings");
  const count = signature.parameters.findIndex(({ name }) => name === encoding.countParameter);
  const expected =
    encoding.kind === "successor" || encoding.kind === "parent" ? "list<int>" : "list<list<int>>";
  if (
    (output
      ? slot === undefined
        ? returnType
        : returnType.slice(5, -1)
      : signature.parameters[arg]?.type
    )?.replaceAll("array<", "list<") !== expected
  )
    throw new Error(`Graph preset requires a ${expected} argument`);
  if (
    encoding.countParameter !== undefined &&
    (output ||
      signature.parameters[count]?.type !== "int" ||
      Object.hasOwn(signature.graphEncodings ?? {}, encoding.countParameter))
  )
    throw new Error("Graph node count must name an int argument");
  return { arg, count };
}

/** Compile only the graph-owned arguments. Other parameters keep their original values. */
function encodeGraph(encoding: GraphEncoding, graph: QuestionGraph, limit: number): WireValue {
  if (!graph.nodes.every(int)) throw new Error("Presets require integer node labels");
  const nodes = graph.nodes as number[];
  const edges = graph.edges as { from: number; to: number; value?: number }[];
  const n = graph.nodes.length;
  const first = encoding.firstNode ?? 0;
  if (encoding.kind === "edgeList") {
    if (
      encoding.countParameter !== undefined &&
      nodes.some((node) => node < first || node >= first + n)
    )
      throw new Error(`Graph nodes must be numbered from ${first} through ${first + n - 1}`);
    return edges.map(({ from, to, value }) => {
      if (encoding.edgeValue ? !int(value) : value !== undefined)
        throw new Error(
          encoding.edgeValue
            ? `Every edge needs ${encoding.edgeValue}`
            : "Edge pairs cannot contain values",
        );
      return value === undefined ? [from, to] : [from, to, value];
    });
  }
  if (nodes.some((node) => node < first || node >= first + n))
    throw new Error(`Graph nodes must be numbered from ${first} through ${first + n - 1}`);
  if (edges.some(({ value }) => value !== undefined))
    throw new Error("This graph preset does not encode edge values");
  if (encoding.kind === "successor" || encoding.kind === "parent") {
    if (encoding.kind === "successor" && !graph.directed)
      throw new Error("Successor edges must be directed");
    const next = Array<number>(n).fill(-1);
    // Both formats index the row by the source. In parent arrays the source is the child.
    for (const { from, to } of edges) {
      if (next[from - first] !== -1) throw new Error("Each node may name at most one next node");
      next[from - first] = to;
    }
    return next;
  }
  const matrix = encoding.kind === "adjacencyMatrix";
  if (matrix && n * n + n > limit) throw new Error("Adjacency matrix exceeds the collection limit");
  const rows: number[][] = Array.from({ length: n }, (_, i) =>
    matrix
      ? Array.from({ length: n }, (_, j) => (i === j ? (encoding.matrixDiagonal ?? 0) : 0))
      : [],
  );
  const put = (from: number, to: number) => {
    const row = rows[from - first]!;
    if (matrix) {
      if (from === to && encoding.matrixDiagonal === 1)
        throw new Error("The matrix diagonal already represents self-connectivity");
      if (row[to - first]) throw new Error("An adjacency matrix cannot encode parallel edges");
      row[to - first] = 1;
    } else row.push(to);
  };
  for (const { from, to } of edges) {
    put(from, to);
    if (!graph.directed && from !== to) put(to, from);
  }
  return rows;
}

/** Compile each graph independently, permitting a shared count when the graphs agree. */
export function projectCaseGraphs(
  signature: Signature,
  graphs: CaseGraphs,
  limit = 100000,
): { args: Map<number, WireValue>; expected?: WireValue; outputSlots: Map<number, WireValue> } {
  const result: ReturnType<typeof projectCaseGraphs> = { args: new Map(), outputSlots: new Map() };
  let remaining = limit;
  let encodedBudget = limit;
  for (const [target, graph] of Object.entries(graphs)) {
    const encodings = signature.graphEncodings;
    if (!encodings || !Object.hasOwn(encodings, target))
      throw new Error(`Choose a graph encoding for ${target}`);
    const encoding = encodings[target]!;
    validateGraph(graph, remaining);
    remaining -= graph.nodes.length + graph.edges.length;
    const indices = graphParameters(signature, target, encoding);
    if (!indices) continue;
    // Charge the native layout before allocating it, especially for dense matrices.
    const n = graph.nodes.length;
    const e = graph.edges.length;
    encodedBudget -=
      encoding.kind === "adjacencyMatrix"
        ? n * n + n
        : encoding.kind === "edgeList"
          ? e * (encoding.edgeValue ? 4 : 3)
          : encoding.kind === "adjacencyList"
            ? n + e * (graph.directed ? 1 : 2)
            : n;
    if (encodedBudget < 0) throw new Error("Generated graph arguments exceed the collection limit");
    const value = encodeGraph(encoding, graph, limit);
    const slot = graphReturnSlot(target);
    if (slot !== undefined) {
      if (slot >= limit) throw new Error("Graph output slot exceeds the collection limit");
      result.outputSlots.set(slot, value);
    } else if (target === GRAPH_RETURN) result.expected = value;
    else result.args.set(indices.arg, value);
    if (indices.count >= 0) {
      const prior = result.args.get(indices.count);
      if (prior !== undefined && prior !== graph.nodes.length)
        throw new Error("Graphs sharing a node count must have the same number of nodes");
      result.args.set(indices.count, graph.nodes.length);
    }
  }
  return result;
}

/** Overlay generated output slots without touching other returned values. */
export function mergeGraphOutput<T>(
  generated: Pick<ReturnType<typeof projectCaseGraphs>, "expected" | "outputSlots">,
  current: T | undefined,
  merge: (current: T | undefined, value: WireValue, target: string) => T,
): T | undefined {
  if (generated.expected !== undefined)
    return merge(current, generated.expected, "expected output");
  if (!generated.outputSlots.size) return current;
  if (current != null && !Array.isArray(current))
    throw new Error("Graph output slots require a list");
  const output = Array.isArray(current) ? [...current] : [];
  for (const [index, value] of generated.outputSlots)
    output[index] = merge(output[index] as T | undefined, value, `expected output [${index}]`);
  // Missing non-graph slots stay absent in authoring until supplied.
  return Array.from(output, (value) => value ?? null) as T;
}

/** Fill generated slots and reject concrete values that disagree with their graphs. */
export function compileGraphCase(
  signature: Signature,
  test: { [key: string]: JsonValue },
  limit: number,
  complete = false,
): void {
  const graphs =
    test.graphs === undefined ? {} : (JSON.parse(stringifyLosslessJson(test.graphs)) as CaseGraphs);
  if (!graphs || typeof graphs !== "object" || Array.isArray(graphs))
    throw new Error("Case graphs must be keyed by parameter name or $return");
  if (complete)
    for (const [target, encoding] of Object.entries(signature.graphEncodings ?? {}))
      if (encoding.kind === "custom" && !Object.hasOwn(graphs, target))
        throw new Error(`Custom graph ${target} requires both a graph and a concrete value`);
  if (!Object.keys(graphs).length) return;
  const generated = projectCaseGraphs(signature, graphs, limit);
  const args = test.args;
  if (!Array.isArray(args) || args.length > signature.parameters.length)
    throw new Error("Graph case arguments must match the signature");
  const merge = (actual: JsonValue | undefined, value: WireValue, target: string) => {
    const native = JSON.stringify(value);
    if (actual != null) {
      if (stringifyLosslessJson(actual) !== native)
        throw new Error(`Graph conflicts with ${target}`);
      return actual;
    }
    return parseLosslessJson(native);
  };
  for (let i = 0; i < signature.parameters.length; i++) {
    if (generated.args.has(i))
      args[i] = merge(args[i], generated.args.get(i)!, signature.parameters[i]!.name);
    else if (i >= args.length || args[i] === undefined)
      throw new Error(`Supply the argument ${signature.parameters[i]!.name}`);
  }
  const expected = mergeGraphOutput(generated, test.expected, merge);
  if (expected !== undefined) test.expected = expected;
  for (const target of Object.keys(graphs)) {
    const slot = graphReturnSlot(target);
    if (slot !== undefined && (!Array.isArray(expected) || expected[slot] === undefined))
      throw new Error(`Supply the concrete value for ${target}`);
  }
}
