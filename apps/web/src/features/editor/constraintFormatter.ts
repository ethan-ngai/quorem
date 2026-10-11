import type { Signature } from "@quorem/contracts";
import { innerType } from "./customCases";

/** Older immutable fixtures used codec-wide prose rather than parameter expressions. */
export function formatConstraint(constraint: string, signature: Signature): string {
  if (constraint === "At most 10,000 collection elements.") {
    return (
      signature.parameters
        .map(({ name, type }) => {
          const base = innerType(type, "optional") ?? type;
          if (base === "TreeNode" || base === "ListNode") return `0 <= node_count(${name}) <= 10^4`;
          if (innerType(base, "list")) return `0 <= len(${name}) <= 10^4`;
          return undefined;
        })
        .filter(Boolean)
        .join("; ") || constraint
    );
  }
  if (constraint === "All integers are signed 32-bit.") {
    return (
      signature.parameters
        .map(({ name, type }) => {
          const base = innerType(type, "optional") ?? type;
          if (base === "int") return `-2^31 <= ${name} <= 2^31 - 1`;
          if (base === "TreeNode" || base === "ListNode")
            return `-2^31 <= node.val <= 2^31 - 1 for nodes in ${name}`;
          if (base === "list<int>") return `-2^31 <= ${name}[i] <= 2^31 - 1`;
          return undefined;
        })
        .filter(Boolean)
        .join("; ") || constraint
    );
  }
  return constraint;
}
