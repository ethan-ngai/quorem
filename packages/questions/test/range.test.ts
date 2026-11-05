import { describe, expect, it } from "vitest";
import {
  rangeContains,
  validateCodingCase,
  validateConstraints,
  validateQuestionSchema,
} from "../src/index.ts";
import type { Constraint, Signature } from "../src/index.ts";
import { readFileSync } from "node:fs";

const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  returnType: "int",
  parameters: [{ name: "value", type: "float" }],
};
const range = {
  kind: "range",
  target: { parameter: "value", projection: "value" },
  min: 0.25,
  max: 0.75,
} satisfies Constraint;

describe("range endpoint inclusion", () => {
  it("checks lower and upper strictness independently at fractional boundaries", () => {
    for (const minInclusive of [true, false])
      for (const maxInclusive of [true, false]) {
        const rule = { ...range, minInclusive, maxInclusive };
        expect(() => validateConstraints(signature, [rule])).not.toThrow();
        for (const value of [0, 0.25, 0.5, 0.75, 1]) {
          const accepted =
            value === 0.5 || (value === 0.25 && minInclusive) || (value === 0.75 && maxInclusive);
          const check = () =>
            validateCodingCase(signature, [rule], JSON.stringify({ args: [value], expected: 0 }));
          if (accepted) expect(check).not.toThrow();
          else expect(check).toThrow("outside allowed range");
        }
      }
    expect(rangeContains(range, 0.25)).toBe(true);
    expect(rangeContains(range, 0.75)).toBe(true);
  });

  it("validates empty intervals and flags without their bound", () => {
    expect(() => validateConstraints(signature, [{ ...range, min: 1, max: 1 }])).not.toThrow();
    for (const flags of [
      { minInclusive: false },
      { maxInclusive: false },
      { minInclusive: false, maxInclusive: false },
    ])
      expect(() =>
        validateConstraints(signature, [{ ...range, min: 1, max: 1, ...flags }]),
      ).toThrow("empty range");
    expect(() =>
      validateConstraints(signature, [{ ...range, min: undefined, max: 1, minInclusive: false }]),
    ).toThrow("corresponding bound");
    expect(() =>
      validateConstraints(signature, [{ ...range, min: 0, max: undefined, maxInclusive: true }]),
    ).toThrow("corresponding bound");
  });

  it("supports one-sided bounds and preserves long precision", () => {
    const long: Signature = { ...signature, parameters: [{ name: "value", type: "long" }] };
    const min = Number.MAX_SAFE_INTEGER;
    const rule: Constraint = { kind: "range", target: range.target, min, minInclusive: false };
    expect(() =>
      validateCodingCase(long, [rule], '{"args":["9007199254740992"],"expected":0}'),
    ).not.toThrow();
    expect(() =>
      validateCodingCase(long, [rule], '{"args":["9007199254740991"],"expected":0}'),
    ).toThrow("outside allowed range");
    expect(
      rangeContains(
        { kind: "range", target: range.target, max: min, maxInclusive: false },
        BigInt(min),
      ),
    ).toBe(false);
    expect(
      rangeContains(
        { kind: "range", target: range.target, max: min, maxInclusive: false },
        BigInt(min) - 1n,
      ),
    ).toBe(true);
    expect(rangeContains(rule, Infinity)).toBe(false);
    expect(rangeContains(rule, NaN)).toBe(false);
  });

  it("round-trips explicit endpoint flags through the canonical import schema", () => {
    const content = JSON.parse(
      readFileSync(new URL("../../contracts/questions/example-v1.json", import.meta.url), "utf8"),
    );
    const original = content.problem.constraints.find((rule: Constraint) => rule.kind === "range");
    content.problem.constraints = [
      { ...original, min: 0, max: 1, minInclusive: false, maxInclusive: true },
    ];
    const json = JSON.stringify(content);
    expect(() => validateQuestionSchema(json)).not.toThrow();
    expect(JSON.parse(json).problem.constraints[0]).toMatchObject({
      minInclusive: false,
      maxInclusive: true,
    });
    delete content.problem.constraints[0].min;
    expect(() => validateQuestionSchema(JSON.stringify(content))).toThrow(
      "invalid question schema",
    );
  });
});
