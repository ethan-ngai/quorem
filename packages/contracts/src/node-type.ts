/** Nodes reserve null for the absent node and tree holes. Payloads are non-null scalars. */
export const nodeKinds = ["ListNode", "TreeNode", "NaryTreeNode"] as const;
export const nodePayloadTypes = ["int", "long", "float", "str", "bool", "datetime"] as const;

export type NodeKind = (typeof nodeKinds)[number];
export type NodePayload = (typeof nodePayloadTypes)[number];

/** OCaml names for node records with an explicit scalar payload. */
export const ocamlNodeNames: Record<NodeKind, string> = {
  ListNode: "typed_list_node",
  TreeNode: "typed_tree_node",
  NaryTreeNode: "nary_tree_node",
};

export function nodeType(type: string) {
  for (const kind of nodeKinds) {
    if (type === kind) return { kind, payload: "int" as const, generic: false };
    if (!type.startsWith(`${kind}<`) || !type.endsWith(">")) continue;
    const payload = nodePayloadTypes.find((value) => value === type.slice(kind.length + 1, -1));
    if (payload) return { kind, payload, generic: true };
  }
}

/** Validate and trim a level-order tree. N-ary nulls separate child groups. */
export function treeEntryCount(kind: "TreeNode" | "NaryTreeNode", entries: readonly unknown[]) {
  let end = entries.length;
  while (end && entries[end - 1] === null) end--;
  if (!end) return 0;
  if (entries[0] === null) throw new Error("null root with children");
  if (kind === "NaryTreeNode") {
    if (end === 1) return end;
    if (entries[1] !== null) throw new Error("expected null before the root's children");
    let parents = 1;
    for (let index = 2; index < end; index++) {
      if (entries[index] === null) parents--;
      else {
        if (parents <= 0) throw new Error("orphan tree node");
        parents++;
      }
    }
    return end;
  }
  let slots = 1;
  for (let index = 0; index < end; index++) {
    if (!slots) throw new Error("orphan tree node");
    slots += entries[index] === null ? -1 : 1;
  }
  return end;
}
