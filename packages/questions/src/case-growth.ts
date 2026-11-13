/** @file case-growth.ts @description Integer growth estimates over authored input dimensions. @module questions */
import type { components } from "@quorem/contracts/schema";
import { JsonNumber, type JsonValue } from "./json.ts";

export type CaseBudget = components["schemas"]["CaseBudget"];
type Growth = components["schemas"]["CaseGrowth"];

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
