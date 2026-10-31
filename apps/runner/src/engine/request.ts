/** @file request.ts @description Lossless, expected-free sandbox requests. @module runner */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
export type JsonObject = { [key: string]: JsonValue };
export function object(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid execution input");
  return value;
}
export function problemMetadata(raw: string): { problem: JsonObject; methods: JsonObject } {
  const problem = object(parseLosslessJson(raw)),
    methods: JsonObject = {};
  if (problem.odyssey) {
    const levels = object(problem.odyssey).levels;
    if (!Array.isArray(levels)) throw new Error("Invalid Odyssey metadata");
    for (const level of levels) {
      const signatures = object(level).methods;
      if (!Array.isArray(signatures)) throw new Error("Invalid Odyssey methods");
      for (const item of signatures) {
        const sig = object(item);
        if (typeof sig.methodName !== "string" || Object.hasOwn(methods, sig.methodName))
          throw new Error("Invalid Odyssey method");
        methods[sig.methodName] = sig;
      }
    }
  }
  return { problem, methods };
}
/** Expected values are intentionally excluded from every untrusted request. */
export function caseRequest(
  source: string,
  problem: JsonObject,
  methods: JsonObject,
  rawCase: string,
  operation: "direct" | "compile-execute" | "execute",
  artifact?: string,
): Uint8Array {
  const value = object(parseLosslessJson(rawCase));
  const calls = Array.isArray(value.calls)
    ? value.calls.map((call) => {
        const c = object(call);
        return { methodName: c.methodName ?? null, args: c.args ?? [] };
      })
    : [];
  const args = value.args ?? [];
  let request: JsonObject;
  if (operation === "execute") {
    if (!artifact) throw new Error("Missing compiled artifact");
    request = { operation, artifact: parseLosslessJson(artifact), args, calls };
  } else if (operation === "compile-execute")
    request = { operation, source, signature: problem.signature ?? null, methods, args, calls };
  else
    request = {
      source,
      signature: problem.signature ?? null,
      args,
      calls,
      methods,
      sql: problem.sql ?? null,
    };
  return new TextEncoder().encode(stringifyLosslessJson(request));
}
