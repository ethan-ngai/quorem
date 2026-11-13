/** @file case-growth.ts @description Integer growth estimates over authored input dimensions. @module questions */
import type { Constraint, Signature } from "./model.ts";
import { JsonNumber, type JsonValue } from "./json.ts";

type Dimension = { argument: number; measure: "length" | "value" };
type Factor = Dimension & { growth: "linear" | "logarithmic" | "linearithmic" | "quadratic" };
type Growth = Factor[][];
export type CaseBudget = { time: Growth; space: Growth };

/** Compile only bounds whose dimensions have a clear meaning. */
export function inferCaseBudget(
  bounds: { timeComplexity: string; spaceComplexity: string },
  signature: Signature,
  constraints: readonly Constraint[],
): CaseBudget | undefined {
  const dimensions = new Map<string, Dimension>();
  const collections = signature.parameters.flatMap((parameter, argument) =>
    /^(?:list<|array<|str$)/.test(parameter.type) ? [argument] : [],
  );
  if (collections.length === 1 && signature.parameters.length === 1)
    dimensions.set("n", { argument: collections[0], measure: "length" });
  for (const constraint of constraints) {
    if (constraint.kind !== "definition") continue;
    const { target, name } = constraint;
    const argument = signature.parameters.findIndex(
      (parameter) => parameter.name === target.parameter,
    );
    const measure = target.projection;
    if (
      argument >= 0 &&
      (measure === "length" || measure === "value") &&
      !target.path &&
      !target.total &&
      !target.offset &&
      !target.operations &&
      (measure === "length"
        ? collections.includes(argument)
        : /^(?:int|long)$/.test(signature.parameters[argument].type))
    )
      dimensions.set(name, { argument, measure });
    else dimensions.delete(name);
  }
  function compile(source: string): Growth | undefined {
    const body = source
      .trim()
      .replace(/^\$|\$$/g, "")
      .match(/^(?:O|Θ|\\Theta)\s*\((.*)\)$/)?.[1];
    if (!body) return undefined;
    const terms: Growth = [];
    for (const term of body
      .replace(/\\(?:cdot|times)/g, "*")
      .replace(/\\log/g, "log")
      .split("+")) {
      const compact = term.replace(/\s/g, "").replace(/\^\{2\}/g, "^2");
      if (/^[1-9]\d*$/.test(compact)) {
        terms.push([]);
        continue;
      }
      const log = compact.match(/^(?:([A-Za-z]\w*)\*?)?log(?:\(([A-Za-z]\w*)\)|([A-Za-z]\w*))$/);
      if (log) {
        const dimension = dimensions.get(log[2] ?? log[3]);
        const multiplier = log[1] ? dimensions.get(log[1]) : undefined;
        if (!dimension || (log[1] && !multiplier)) return undefined;
        terms.push([
          ...(multiplier ? [{ ...multiplier, growth: "linear" as const }] : []),
          { ...dimension, growth: "logarithmic" },
        ]);
        continue;
      }
      const factors: Factor[] = [];
      for (const token of compact.split("*")) {
        const match = token.match(/^([A-Za-z]\w*)(\^2)?$/);
        const dimension = match && dimensions.get(match[1]);
        if (!match || !dimension) return undefined;
        factors.push({ ...dimension, growth: match[2] ? "quadratic" : "linear" });
      }
      terms.push(factors);
    }
    return terms;
  }
  const time = compile(bounds.timeComplexity);
  const space = compile(bounds.spaceComplexity);
  return time && space ? { time, space } : undefined;
}

export function caseGrowth(expression: Growth, args: readonly JsonValue[]): bigint {
  const cap = 1_000_000_000_000n;
  let sum = 0n;
  for (const term of expression) {
    let product = 1n;
    for (const factor of term) {
      const value = args[factor.argument];
      let size: bigint;
      if (factor.measure === "length" && Array.isArray(value)) size = BigInt(value.length);
      else if (factor.measure === "length" && typeof value === "string")
        size = BigInt([...value].length);
      else if (
        factor.measure === "value" &&
        value instanceof JsonNumber &&
        /^\d{1,32}$/.test(value.lexeme)
      )
        size = BigInt(value.lexeme);
      else throw new Error("Case budget measurement does not match the input");
      size = size < 1n ? 1n : size > cap ? cap : size;
      const log = BigInt(size.toString(2).length);
      const weight = {
        linear: size,
        logarithmic: log,
        linearithmic: size * log,
        quadratic: size * size,
      }[factor.growth];
      product *= weight;
      if (product > cap) product = cap;
    }
    sum += product;
  }
  return sum > cap ? cap : sum;
}
