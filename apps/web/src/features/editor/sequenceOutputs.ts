import type { MethodCall, Signature } from "@quorem/contracts";

/** Keep call positions for repeated methods; a method returning a list still has one output. */
export function sequenceOutputs(
  methods: readonly Signature[],
  calls: readonly MethodCall[],
  values?: readonly unknown[],
) {
  return calls.flatMap((call, index) => {
    const signature = methods.find((method) => method.methodName === call.methodName);
    const value = values ? values[index] : call.expected;
    return signature?.returnType === "void" || value === undefined
      ? []
      : [{ methodName: call.methodName, call: index + 1, value, type: signature?.returnType }];
  });
}
