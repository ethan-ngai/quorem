/** Nodes reserve null for the absent node and tree holes. Payloads are non-null scalars. */
export const nodeKinds = ["ListNode", "TreeNode"] as const;
export const nodePayloadTypes = ["int", "long", "float", "str", "bool", "datetime"] as const;

export type NodeKind = (typeof nodeKinds)[number];
export type NodePayload = (typeof nodePayloadTypes)[number];

export function nodeType(type: string) {
  for (const kind of nodeKinds) {
    if (type === kind) return { kind, payload: "int" as const, generic: false };
    if (!type.startsWith(`${kind}<`) || !type.endsWith(">")) continue;
    const payload = nodePayloadTypes.find((value) => value === type.slice(kind.length + 1, -1));
    if (payload) return { kind, payload, generic: true };
  }
}
