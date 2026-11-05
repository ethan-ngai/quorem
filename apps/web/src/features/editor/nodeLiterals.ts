/** @file nodeLiterals.ts @description Editable tree rows and call-local preorder node references. @module editor */
import type { Signature } from "@quorem/contracts";
import { nodeType } from "@quorem/contracts/node-type";
import { validateTypedValue, type WireValue } from "./typedValues";
import { MAX_CUSTOM_CASE_BYTES, MAX_INPUT_ELEMENTS } from "./inputLimits";

type Node = { value: WireValue; children: Node[]; dense?: number };
export type NodeContext = {
  signature: Signature;
  args?: readonly WireValue[];
  sources?: readonly string[];
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Build nodes from the canonical level-order array, retaining original judge indices. */
function tree(type: string, value: WireValue): Node | undefined {
  validateTypedValue(type, value);
  if (value === null || !Array.isArray(value) || !value.length || value[0] === null) return;
  const make = (value: WireValue): Node => ({ value, children: [] });
  const root = make(value[0]);
  root.dense = 0;
  const parents = [root];
  if (nodeType(type)?.kind === "TreeNode") {
    let offset = 1;
    for (let parent = 0; parent < parents.length && offset < value.length; parent++) {
      for (let slot = 0; slot < 2; slot++) {
        const child = make(value[offset++] ?? null);
        parents[parent].children.push(child);
        if (child.value !== null) {
          child.dense = parents.length;
          parents.push(child);
        }
      }
    }
    // Leaves omit their two implicit holes in the editable literal.
    for (const parent of parents)
      if (parent.children.every((child) => child.value === null)) parent.children = [];
  } else {
    let parent = 0;
    for (const item of value.slice(2)) {
      if (item === null) {
        parent++;
        continue;
      }
      const child = make(item);
      child.dense = parents.length;
      parents[parent].children.push(child);
      parents.push(child);
    }
  }
  return root;
}

/** Iterative preorder includes explicit binary holes and supports deep stored trees. */
function preorder(root: Node | undefined) {
  const result: Node[] = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index--)
      stack.push(node.children[index]);
  }
  return result;
}

function scalar(type: string, value: WireValue) {
  return nodeType(type)?.payload === "long" && typeof value === "string"
    ? value
    : JSON.stringify(value);
}

/** Keep groups compact and center each level as a complete row. */
function formatTree(type: string, value: WireValue): string {
  const root = tree(type, value);
  if (!root) return "null";
  const label = (node: Node) => scalar(type, node.value);
  const lines = [label(root)];
  let parents = [root];
  let size = lines[0].length;
  while (parents.some((node) => node.children.length)) {
    const line = parents.map((parent) => `(${parent.children.map(label).join(", ")})`).join(" ");
    size += line.length + 1;
    if (size > MAX_CUSTOM_CASE_BYTES) return JSON.stringify(value);
    lines.push(line);
    parents = parents.flatMap((parent) => parent.children.filter((child) => child.value !== null));
  }
  const width = lines.reduce((width, line) => Math.max(width, line.length), 0);
  const formattedSize = lines.reduce(
    (size, line) => size + line.length + Math.round((width - line.length) / 2) + 1,
    0,
  );
  if (formattedSize > MAX_CUSTOM_CASE_BYTES) return JSON.stringify(value);
  return lines.map((line) => " ".repeat(Math.round((width - line.length) / 2)) + line).join("\n");
}

/** Read scalar tokens and punctuation without splitting quoted strings. */
function tokens(source: string) {
  const result: string[] = [];
  const pattern = /\s*("(?:[^"\\]|\\.)*"|[(),]|[^\s(),]+)/gy;
  let offset = 0;
  while (offset < source.trimEnd().length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error("Complete the quoted node value.");
    result.push(match[1]);
    offset = pattern.lastIndex;
    if (result.length > MAX_INPUT_ELEMENTS * 4) throw new Error("Too many node entries.");
  }
  return result;
}

/** Parse child groups in breadth-first parent order; whitespace carries no structure. */
function parseTree(type: string, source: string): WireValue {
  if (source.trimStart().startsWith("[")) return JSON.parse(source) as WireValue;
  const items = tokens(source);
  const payload = nodeType(type)!.payload;
  const value = (token: string | undefined): WireValue => {
    if (!token || ["(", ")", ","].includes(token)) throw new Error("Enter a node value.");
    const parsed: WireValue =
      payload === "long" && /^-?\d+$/.test(token) ? token : JSON.parse(token);
    if (parsed !== null) validateTypedValue(payload, parsed);
    return parsed;
  };
  const root = value(items.shift());
  if (root === null) {
    if (items.length) throw new Error("A null root cannot have children.");
    return null;
  }
  const binary = nodeType(type)!.kind === "TreeNode";
  const result: WireValue[] = [root];
  const parents = [root];
  let offset = 0;
  let parent = 0;
  if (!binary) result.push(null);
  while (offset < items.length) {
    if (parent++ >= parents.length)
      throw new Error("Add one child group per parent, left to right.");
    let children: WireValue[] = [];
    if (items[offset++] !== "(") throw new Error("Wrap each child group in parentheses.");
    if (items[offset] !== ")") {
      for (;;) {
        const token = items[offset];
        const omitted = token === "," || token === ")";
        children.push(omitted || token === "_" ? null : value(token));
        if (!omitted) offset++;
        if (items[offset] !== ",") break;
        offset++;
      }
    }
    if (items[offset++] !== ")") throw new Error("Close each child group with ).");
    if (binary) {
      if (children.length > 2) throw new Error("Binary child groups have at most two slots.");
      while (children.length < 2) children.push(null);
    } else children = children.filter((child) => child !== null);
    result.push(...children);
    if (!binary) result.push(null);
    parents.push(...children.filter((child) => child !== null));
  }
  while (result.at(-1) === null) result.pop();
  return result;
}

/** Reference indices address the original seed, before any list-tail connections. */
function referenceSeed(
  type: string,
  argument: number,
  context: NodeContext,
): WireValue | undefined {
  if (!context.sources) return context.args?.[argument];
  const source = context.sources[argument] ?? "";
  const tail = /^(\[[\s\S]*\])\s*->/.exec(source);
  return parseNodeLiteral(type, tail?.[1] ?? source);
}

function target(context: NodeContext | undefined, name: string, index: number, type: string) {
  if (!context?.signature.nodeReferences)
    throw new Error("This method does not accept node references.");
  const argument = context.signature.parameters.findIndex((parameter) => parameter.name === name);
  if (argument < 0 || context.signature.parameters[argument].type !== type)
    throw new Error("Choose a parameter with the same node type.");
  const seed = referenceSeed(type, argument, context);
  if (seed === undefined || record(seed)?.ref)
    throw new Error("References must select a parameter with its own node values.");
  const values = (record(seed)?.values ?? seed) as WireValue;
  const dense =
    nodeType(type)?.kind === "ListNode" ? index : preorder(tree(type, values))[index]?.dense;
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    dense === undefined ||
    (nodeType(type)?.kind === "ListNode" && (!Array.isArray(values) || index >= values.length))
  )
    throw new Error("That index does not select an existing node.");
  return [argument, dense];
}

/** Parse editor literals to the existing database/judge representation. */
export function parseNodeLiteral(type: string, source: string, context?: NodeContext): WireValue {
  if (source.length > MAX_CUSTOM_CASE_BYTES) throw new Error("Input exceeds 2 MiB.");
  const ref = /^\s*([A-Za-z_]\w*)\[(\d+)\]\s*$/.exec(source);
  if (ref) return { ref: target(context, ref[1], Number(ref[2]), type) };
  if (source.trimStart().startsWith("{")) return JSON.parse(source) as WireValue;
  const tail = /^(\[[\s\S]*\])\s*->\s*([A-Za-z_]\w*)\[(\d+)\]\s*$/.exec(source);
  if (tail) {
    if (nodeType(type)?.kind !== "ListNode") throw new Error("Only linked lists have a tail.");
    const values: WireValue = JSON.parse(tail[1]);
    validateTypedValue(type, values);
    return { values, tail: target(context, tail[2], Number(tail[3]), type) };
  }
  const value =
    nodeType(type)?.kind === "ListNode"
      ? (JSON.parse(source) as WireValue)
      : parseTree(type, source);
  validateTypedValue(type, value);
  return value;
}

/** Format a reference with the parameter name and its visible preorder index. */
function formatReference(type: string, ref: unknown, context?: NodeContext) {
  if (!context || !Array.isArray(ref)) throw new Error("Node reference context is unavailable.");
  const [argument, dense] = ref as number[];
  const parameter = context.signature.parameters[argument];
  const seed = referenceSeed(type, argument, context);
  if (!parameter || seed === undefined) throw new Error("Node reference values are unavailable.");
  const values = (record(seed)?.values ?? seed) as WireValue;
  const index =
    nodeType(type)?.kind === "ListNode"
      ? dense
      : preorder(tree(type, values)).findIndex((node) => node.dense === dense);
  if (index < 0) throw new Error("Node reference index is unavailable.");
  return `${parameter.name}[${index}]`;
}

/** Produce centered child groups or a named reference for display and editing. */
export function formatNodeLiteral(type: string, value: WireValue, context?: NodeContext): string {
  const object = record(value);
  if (object?.ref) return formatReference(type, object.ref, context);
  if (object?.tail)
    return `${JSON.stringify(object.values)} -> ${formatReference(type, object.tail, context)}`;
  if (nodeType(type)?.kind === "ListNode") return JSON.stringify(value);
  return formatTree(type, value);
}
