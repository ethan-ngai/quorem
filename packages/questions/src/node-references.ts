/** @file node-references.ts @description Validate call-local references into serialized nodes. @module questions */
import { nodeType } from "@quorem/contracts/node-type";
import { JsonNumber, type JsonValue } from "./json.ts";
import type { Signature } from "./model.ts";
import { normalizeQuestionValue } from "./value-codec.ts";

type ReferenceObject = { [key: string]: JsonValue };

/** Recognize the object wire form without treating arrays or numeric lexemes as records. */
function nodeRecord(value: JsonValue): ReferenceObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof JsonNumber))
    return value;
}

/** Resolve the two zero-based indices in a node selector. */
function referenceIndices(value: JsonValue): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(
      (part) =>
        part instanceof JsonNumber &&
        /^\d+$/.test(part.lexeme) &&
        Number.isSafeInteger(Number(part.lexeme)),
    )
  )
    throw new Error("expected node reference [argument index, node index]");
  return [Number((value[0] as JsonNumber).lexeme), Number((value[1] as JsonNumber).lexeme)];
}

/** Validate the return's wire shape independently of a specific case. */
export function normalizeNodeReference(value: JsonValue) {
  if (value === null) return null;
  const record = nodeRecord(value);
  if (!record || Object.keys(record).length !== 1 || !Object.hasOwn(record, "ref"))
    throw new Error("expected node reference object or null");
  const indices = referenceIndices(record.ref);
  return { ref: indices.map((index) => new JsonNumber(String(index))) };
}

/** Validate references against concrete argument seeds before the harness links them. */
export function normalizeNodeArguments(sig: Signature, args: JsonValue[], limit: number) {
  const records = args.map((arg) => (sig.nodeReferences ? nodeRecord(arg) : undefined));
  const seeds = args.map((arg, index) => {
    const { name, type } = sig.parameters[index];
    const record = records[index];
    try {
      if (!record || !nodeType(type)) return normalizeQuestionValue(type, arg, limit);
      if (Object.hasOwn(record, "ref") && Object.keys(record).length === 1) return null;
      if (
        nodeType(type)?.kind === "ListNode" &&
        Object.keys(record).length === 2 &&
        Array.isArray(record.values) &&
        Object.hasOwn(record, "tail")
      ) {
        const values = normalizeQuestionValue(type, record.values, limit);
        if (values !== null) return values;
      }
      throw new Error("expected a node array, reference, or nonempty list with a tail reference");
    } catch (error) {
      throw new Error(`argument ${name}: ${(error as Error).message}`);
    }
  });
  const resolve = (type: string, ref: JsonValue) => {
    const [argument, node] = referenceIndices(ref);
    const seed = seeds[argument];
    if (
      sig.parameters[argument]?.type !== type ||
      !Array.isArray(seed) ||
      node >= seed.filter((value) => value !== null).length
    )
      throw new Error("node reference must target a compatible node in an argument seed");
  };
  for (const [index, record] of records.entries()) {
    if (!record) continue;
    const { type } = sig.parameters[index];
    if (Object.hasOwn(record, "ref")) resolve(type, record.ref);
    else resolve(type, record.tail);
  }
  const projected = (index: number): JsonValue => {
    const type = nodeType(sig.parameters[index].type);
    if (!type || !records.some(Boolean)) return seeds[index];
    const record = records[index];
    const [argument, node] = record?.ref === undefined ? [index, 0] : referenceIndices(record.ref);
    if (type.kind !== "ListNode")
      return node === 0
        ? seeds[argument]
        : subtreeValues(type.kind, seeds[argument] as JsonValue[], node);
    const values: JsonValue[] = [];
    const visited = new Map<number, number>();
    let current = argument;
    let start = node;
    while (Array.isArray(seeds[current])) {
      const seed = seeds[current] as JsonValue[];
      const previous = visited.get(current);
      if (previous !== undefined && previous <= start) break;
      for (let offset = start; offset < (previous ?? seed.length); offset++)
        values.push(seed[offset]);
      visited.set(current, start);
      const tail = records[current]?.tail;
      if (tail === undefined || previous !== undefined) break;
      [current, start] = referenceIndices(tail);
    }
    return values;
  };
  return { projected, resolve };
}

/** Extract the breadth-first values under an aliased node, skipping unselected parent groups. */
function subtreeValues(kind: "TreeNode" | "NaryTreeNode", seed: JsonValue[], root: number) {
  const values: JsonValue[] = [];
  const included = [false];
  let parent = 0;
  let slots = 0;
  for (let i = kind === "TreeNode" ? 1 : 2; i < seed.length; i++) {
    const value = seed[i];
    if (value !== null) {
      const selected = included.length === root || included[parent];
      included.push(selected);
      if (selected) values.push(value);
    }
    if (kind === "TreeNode") {
      if (++slots === 2) {
        parent++;
        slots = 0;
      }
    } else if (value === null) parent++;
  }
  return values;
}
