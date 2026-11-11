/** @file constraintGraph.ts @description Topology predicates for native graph presets. @module questions */
import { graphNodeId, type GraphNodeId, type QuestionGraph } from "./graph.ts";
import type { Constraint } from "./model.ts";

type Property = Extract<Constraint, { kind: "property" }>["property"];

export function graphPropertyMatches(
  property: Property,
  { nodes, edges, directed }: QuestionGraph,
) {
  if (property === "noLoops") return edges.every(({ from, to }) => from !== to);
  if (property === "noParallelEdges") {
    const keys = edges.map(({ from, to }) =>
      JSON.stringify(directed || from <= to ? [from, to] : [to, from]),
    );
    return new Set(keys).size === keys.length;
  }
  const adjacent = new Map<GraphNodeId, GraphNodeId[]>(
    nodes.map((node) => [graphNodeId(node), []]),
  );
  const indegree = new Map<GraphNodeId, number>([...adjacent.keys()].map((node) => [node, 0]));
  const directedCycle = property === "acyclic" && directed;
  for (const { from, to } of edges) {
    adjacent.get(from)!.push(to);
    if (directedCycle || property === "binaryTree") indegree.set(to, indegree.get(to)! + 1);
    if (!directedCycle) adjacent.get(to)!.push(from);
  }
  if (directedCycle) {
    const queue = [...indegree].filter(([, count]) => count === 0).map(([node]) => node);
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacent.get(queue[i])!) {
        const count = indegree.get(next)! - 1;
        indegree.set(next, count);
        if (!count) queue.push(next);
      }
    return queue.length === nodes.length;
  }
  // For an undirected graph, each connected component is acyclic iff E = V - 1.
  const seen = new Set<GraphNodeId>();
  let components = 0;
  for (const node of adjacent.keys()) {
    if (seen.has(node)) continue;
    const queue = [node];
    seen.add(node);
    components++;
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacent.get(queue[i])!) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
  }
  const forest = edges.length === nodes.length - components;
  if (property === "acyclic") return forest;
  if (!forest || components !== 1) return false;
  if (property === "star")
    return [...adjacent.values()].some((neighbors) => neighbors.length === nodes.length - 1);
  if (property === "binaryTree") return [...indegree.values()].every((count) => count <= 2);
  return property === "tree";
}
