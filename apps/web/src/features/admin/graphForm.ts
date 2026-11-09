/** @file graphForm.ts @description Editable graph cells and their lossless case projection. @module admin */
import { graphNodeId, type GraphEncoding, type QuestionGraph } from "@quorem/questions";
import type { WireValue } from "../editor/typedValues";
import { parseTypedField } from "../editor/customCases";
import { randomUUID } from "../../randomUUID";

export type GraphForm = {
  directed: boolean;
  nodes: string;
  edges: GraphRow[];
  nodeValues: NodeValueRow[];
};
export type GraphRow = { id: string; from: string; to: string; value: string };
export type NodeValueRow = { id: string; node: string; value: string };
const integer = /^-?(?:0|[1-9]\d*)$/;

export const numberedGraph = (encoding: GraphEncoding) =>
  encoding.kind !== "custom" && (encoding.kind !== "edgeList" || !!encoding.countParameter);

function token(value: number | string): string {
  return typeof value === "number"
    ? String(value)
    : !Number.isFinite(Number(value)) && /^[\p{L}\p{N}_ -]+$/u.test(value) && value.trim() === value
      ? value
      : JSON.stringify(value);
}

function readLabel(source: string): string | number {
  const value = source.trim();
  if (integer.test(value)) return Number(value);
  if (!value) throw new Error("Enter each node label.");
  if (value.startsWith('"')) {
    const label: unknown = JSON.parse(value);
    if (typeof label !== "string") throw new Error("Use a node label.");
    return label;
  }
  return value;
}

export function graphRow(from = "", to = "", value = ""): GraphRow {
  return { id: randomUUID(), from, to, value };
}

function formatValue(value: WireValue, type?: string): string {
  if (type) return JSON.stringify(value);
  return typeof value === "string" && !/^(true|false|null)$/.test(value)
    ? token(value)
    : JSON.stringify(value);
}

function readValue(source: string, type?: string): WireValue {
  const text = source.trim();
  if (type && ["str", "long", "datetime"].includes(type) && !text.startsWith('"'))
    return parseTypedField(type, source);
  if (type) return JSON.parse(text) as WireValue;
  if (!text) throw new Error('Enter a value or use "" for empty text.');
  if (/^["[{]|^(true|false|null)$/.test(text)) return JSON.parse(text) as WireValue;
  return Number.isFinite(Number(text)) ? Number(text) : text;
}

export const nodeValueRow = (node = "", value = ""): NodeValueRow => ({
  id: randomUUID(),
  node,
  value,
});

export function graphToForm(graph: QuestionGraph, encoding: GraphEncoding): GraphForm {
  return {
    directed: graph.directed,
    nodes: numberedGraph(encoding)
      ? String(graph.nodes.length)
      : graph.nodes.map((node) => token(graphNodeId(node))).join(", "),
    edges: graph.edges.map(({ from, to, value }) =>
      graphRow(
        token(from),
        token(to),
        value === undefined ? "" : formatValue(value, encoding.edgeValueType),
      ),
    ),
    nodeValues: graph.nodes.flatMap((node) =>
      typeof node === "object"
        ? [nodeValueRow(token(node.id), formatValue(node.value, encoding.nodeValueType))]
        : [],
    ),
  };
}

export function graphFromForm(
  form: GraphForm,
  encoding: GraphEncoding,
  limit: number,
): QuestionGraph {
  let nodes: QuestionGraph["nodes"];
  if (numberedGraph(encoding)) {
    const count = Number(form.nodes);
    if (!/^\d+$/.test(form.nodes) || count > limit)
      throw new Error(`Enter a node count from 0 to ${limit}.`);
    nodes = Array.from({ length: count }, (_, i) => i + (encoding.firstNode ?? 0));
  } else {
    // Split at commas and newlines outside quoted labels.
    const source = form.nodes.trim();
    const tokens = source.match(/(?:\s*"(?:[^"\\]|\\.)*"\s*|[^,\n"]+)(?=[,\n]|$)/g) ?? [];
    if (
      source.replace(/[,\n]/g, "").replace(/\s/g, "") !==
      tokens.join("").replace(/[,\n]/g, "").replace(/\s/g, "")
    )
      throw new Error("Separate node labels with commas and close quoted labels.");
    nodes = tokens
      .map((source) => source.trim())
      .filter(Boolean)
      .map(readLabel);
  }
  const ids = new Set(nodes.map(graphNodeId));
  const payloads = new Map<string | number, WireValue>();
  for (const { node, value } of form.nodeValues) {
    const id = readLabel(node);
    if (!ids.has(id)) throw new Error("Node values must refer to an existing node ID.");
    if (payloads.has(id)) throw new Error("A node can have only one value.");
    payloads.set(id, readValue(value, encoding.nodeValueType));
  }
  const edges = form.edges.map(({ from, to, value }) => {
    const edge = { from: readLabel(from), to: readLabel(to) };
    return value.trim()
      ? {
          ...edge,
          value:
            encoding.kind === "custom"
              ? readValue(value, encoding.edgeValueType)
              : readLabel(value),
        }
      : edge;
  });
  return {
    directed: form.directed,
    nodes: nodes.map((node) => {
      const id = graphNodeId(node);
      const value = payloads.get(id);
      return value === undefined ? id : { id, value };
    }),
    edges,
  };
}
