import type { Signature } from "@quorem/contracts";

export function bindArguments<T>(signature: Signature, args: readonly T[]) {
  if (args.length !== signature.parameters.length) throw new Error("Wrong argument count.");
  return signature.parameters.map((parameter, index) => ({ ...parameter, value: args[index]! }));
}
