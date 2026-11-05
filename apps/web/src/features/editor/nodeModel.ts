/** @file nodeModel.ts @description Shared node topology and stable preorder indices. @module editor */
import { nodeType } from "@quorem/contracts/node-type";
import { validateTypedValue, type WireValue } from "./typedValues";

export type NodeValue = { value: WireValue; children: NodeValue[]; dense?: number };

/** Build nodes from the canonical level-order array, retaining original judge indices. */
export function decodeTree(type: string, value: WireValue): NodeValue | undefined {
  validateTypedValue(type, value);
  if (value === null || !Array.isArray(value) || !value.length || value[0] === null) return;
  const make = (value: WireValue): NodeValue => ({ value, children: [] });
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
export function preorderNodes(root: NodeValue | undefined) {
  const result: NodeValue[] = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index--)
      stack.push(node.children[index]);
  }
  return result;
}
