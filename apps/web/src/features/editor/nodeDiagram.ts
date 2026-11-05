/** @file nodeDiagram.ts @description Finite node diagrams with shared identity and reference labels. @module editor */
import { nodeType, treeEntryCount } from "@quorem/contracts/node-type";
import { decodeTree, preorderNodes } from "./nodeModel";
import { parseNodeLiteral, type NodeContext } from "./nodeLiterals";
import { validateTypedValue, type WireValue } from "./typedValues";

export type DiagramNode = {
  id: string;
  type: string;
  label: string;
  reference?: string;
  names: string[];
  outputs?: ("expected" | "actual")[];
  missing: boolean;
  empty?: boolean;
  children: string[];
};
export type DiagramEdge = { from: string; to: string; tail: boolean };
export type NodeDiagram = {
  nodes: DiagramNode[];
  roots: string[];
  edges: DiagramEdge[];
  selected?: string;
  list: boolean;
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Unwrap optional nodes without changing their payload type. */
export function nodeValueType(type?: string) {
  while (type?.startsWith("optional<")) type = type.slice(9, -1);
  return type && nodeType(type) ? type : undefined;
}

/** Decode every seed before connecting aliases or tails, so cycles never recurse. */
export function buildNodeDiagram(
  type: string,
  value: WireValue,
  context?: NodeContext,
  name?: string,
): NodeDiagram {
  const kind = nodeType(type)!;
  const diagram: NodeDiagram = { nodes: [], roots: [], edges: [], list: kind.kind === "ListNode" };
  const byId = new Map<string, DiagramNode>();
  const aliases: { name: string; ref: number[] }[] = [];
  const tails: { from: string; ref: number[] }[] = [];
  const valueRef = object(value)?.ref as number[] | undefined;
  const useContext =
    !!context &&
    (!!valueRef ||
      !!object(value)?.tail ||
      context.signature.parameters.some((p) => p.name === name && nodeValueType(p.type) === type));
  const seeds: { key: string; name?: string; value: WireValue }[] = [];
  if (useContext) {
    context.signature.parameters.forEach((parameter, argument) => {
      if (nodeValueType(parameter.type) !== type) return;
      try {
        const seed = context.sources
          ? parseNodeLiteral(type, context.sources[argument] ?? "", context)
          : context.args?.[argument];
        if (seed !== undefined)
          seeds.push({ key: String(argument), name: parameter.name, value: seed });
      } catch {
        /* Other valid structures remain visible during an incomplete edit. */
      }
    });
  } else seeds.push({ key: "value", name, value });

  const add = (node: DiagramNode) => {
    diagram.nodes.push(node);
    byId.set(node.id, node);
  };
  for (const seed of seeds) {
    const wire = object(seed.value);
    if (wire?.ref) {
      aliases.push({ name: seed.name ?? "", ref: wire.ref as number[] });
      continue;
    }
    const values = (wire?.values ?? seed.value) as WireValue;
    validateTypedValue(type, values);
    if (
      values === null ||
      (Array.isArray(values) &&
        (!values.length || (kind.kind !== "ListNode" && values[0] === null)))
    ) {
      const id = `${seed.key}:empty`;
      add({
        id,
        type,
        label: "∅",
        names: seed.name ? [seed.name] : [],
        missing: false,
        empty: true,
        children: [],
      });
      diagram.roots.push(id);
      continue;
    }
    if (kind.kind === "ListNode") {
      if (!Array.isArray(values)) continue;
      values.forEach((item, index) => {
        const id = `${seed.key}:${index}`;
        add({
          id,
          type,
          label: kind.payload === "long" ? (item as string) : JSON.stringify(item),
          reference: seed.name ? `${seed.name}[${index}]` : undefined,
          names: index === 0 && seed.name ? [seed.name] : [],
          missing: false,
          children: index + 1 < values.length ? [`${seed.key}:${index + 1}`] : [],
        });
      });
      if (values.length) {
        diagram.roots.push(`${seed.key}:0`);
        if (wire?.tail)
          tails.push({ from: `${seed.key}:${values.length - 1}`, ref: wire.tail as number[] });
      }
    } else {
      const root = decodeTree(type, values);
      const nodes = preorderNodes(root);
      const ids = new Map(
        nodes.map((node, index) => [node, `${seed.key}:${node.dense ?? `hole-${index}`}`]),
      );
      nodes.forEach((node, index) =>
        add({
          id: ids.get(node)!,
          type,
          label:
            node.value === null
              ? "∅"
              : kind.payload === "long"
                ? (node.value as string)
                : JSON.stringify(node.value),
          reference: seed.name && node.value !== null ? `${seed.name}[${index}]` : undefined,
          names: index === 0 && seed.name ? [seed.name] : [],
          missing: node.value === null,
          children: node.children.map((child) => ids.get(child)!),
        }),
      );
      if (root) diagram.roots.push(ids.get(root)!);
    }
  }
  for (const node of diagram.nodes)
    for (const child of node.children)
      diagram.edges.push({ from: node.id, to: child, tail: false });
  const resolve = (ref: number[]) => {
    const id = `${ref[0]}:${ref[1]}`;
    if (!byId.has(id)) throw new Error("The referenced input node is unavailable.");
    return id;
  };
  for (const alias of aliases) byId.get(resolve(alias.ref))!.names.push(alias.name);
  for (const tail of tails)
    diagram.edges.push({ from: tail.from, to: resolve(tail.ref), tail: true });
  if (valueRef) diagram.selected = resolve(valueRef);
  return diagram;
}

export type CaseDiagram = NodeDiagram & {
  groups: { roots: string[]; list: boolean }[];
  outputMatchesExpected?: boolean;
};

/** Combine a case's structures by original argument identity, with output selectors on the same nodes. */
export function buildCaseDiagram(
  context: NodeContext,
  expected?: WireValue,
  actual?: WireValue,
): CaseDiagram {
  const result: CaseDiagram = { nodes: [], edges: [], roots: [], list: false, groups: [] };
  const outputType = nodeValueType(context.signature.returnType);
  const normalize = (value: WireValue | undefined) => {
    if (!outputType || !Array.isArray(value)) return value;
    const kind = nodeType(outputType)!;
    const count = kind.kind === "ListNode" ? value.length : treeEntryCount(kind.kind, value);
    return count ? value.slice(0, count) : null;
  };
  expected = normalize(expected);
  actual = normalize(actual);
  if (expected !== undefined && actual !== undefined)
    result.outputMatchesExpected = JSON.stringify(expected) === JSON.stringify(actual);
  const types = new Set(
    context.signature.parameters
      .map(({ type }) => nodeValueType(type))
      .filter((type): type is string => !!type),
  );
  for (const type of types) {
    const name = context.signature.parameters.find(
      (parameter) => nodeValueType(parameter.type) === type,
    )!.name;
    const graph = buildNodeDiagram(nodeValueType(type)!, null, context, name);
    result.nodes.push(...graph.nodes);
    result.edges.push(...graph.edges);
    result.roots.push(...graph.roots);
    result.groups.push({ roots: graph.roots, list: graph.list });
  }
  if (outputType)
    for (const [role, value] of [
      ["expected", expected],
      ["actual", actual],
    ] as const) {
      if (value === undefined) continue;
      if (value === null && role === "actual") {
        const matching = result.nodes.find(
          (node) => node.empty && node.outputs?.includes("expected"),
        );
        if (matching) {
          matching.outputs!.push(role);
          continue;
        }
      }
      const ref = object(value)?.ref as number[] | undefined;
      if (ref) {
        const id = `${ref[0]}:${ref[1]}`;
        const node = result.nodes.find((node) => node.id === id);
        if (node) {
          (node.outputs ??= []).push(role);
        }
      } else {
        const graph = buildNodeDiagram(outputType, value);
        const id = (value: string) => `${role}:${value}`;
        for (const node of graph.nodes)
          result.nodes.push({
            ...node,
            id: id(node.id),
            children: node.children.map(id),
            outputs: node.id === graph.roots[0] ? [role] : undefined,
          });
        result.edges.push(
          ...graph.edges.map((edge) => ({ ...edge, from: id(edge.from), to: id(edge.to) })),
        );
        const roots = graph.roots.map(id);
        result.roots.push(...roots);
        result.groups.push({ roots, list: graph.list });
      }
    }
  return result;
}
