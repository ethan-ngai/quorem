import { describe, expect, it } from "vitest";
import { constraintMarkup } from "./constraintMarkup";

describe("constraint Markdown composition", () => {
  it("separates machine targets from numeric bounds and powers", () => {
    expect(
      constraintMarkup({
        kind: "range",
        target: { parameter: "loads", projection: "elements" },
        min: -10000,
        max: 2147483647,
      }),
    ).toBe("$-10^{4}$ $\\le$ ` loads[i] ` $\\le$ $2^{31} - 1$");
  });
  it("composes comparisons and node ownership from metadata", () => {
    expect(
      constraintMarkup({
        kind: "comparison",
        left: { parameter: "a", projection: "length" },
        operator: "lt",
        right: { parameter: "b", projection: "sum" },
      }),
    ).toBe("` len(a) ` $<$ ` sum(b) `");
    expect(
      constraintMarkup({
        kind: "range",
        target: { parameter: "root", projection: "nodeValues" },
        min: 0,
      }),
    ).toBe("` node.val ` $\\ge$ $0$ (nodes in ` root `)");
  });
  it("preserves prose and quotes parameter delimiters", () => {
    expect(constraintMarkup({ kind: "prose", text: "Use `x` and $x^2$." })).toBe(
      "Use `x` and $x^2$.",
    );
    expect(
      constraintMarkup({
        kind: "property",
        target: { parameter: "a`b", projection: "value" },
        property: "unique",
      }),
    ).toBe("`` a`b `` contains unique values");
  });
});

it("renders strict endpoints independently in math markup", () => {
  const target = { parameter: "x", projection: "value" } as const;
  expect(constraintMarkup({ kind: "range", target, min: 0, max: 1, minInclusive: false })).toBe(
    "$0$ $<$ ` x ` $\\le$ $1$",
  );
  expect(constraintMarkup({ kind: "range", target, min: 0, max: 1, maxInclusive: false })).toBe(
    "$0$ $\\le$ ` x ` $<$ $1$",
  );
  expect(
    constraintMarkup({
      kind: "range",
      target,
      min: 0,
      max: 1,
      minInclusive: false,
      maxInclusive: false,
    }),
  ).toBe("$0$ $<$ ` x ` $<$ $1$");
  expect(constraintMarkup({ kind: "range", target, min: 0, minInclusive: false })).toBe(
    "` x ` $>$ $0$",
  );
  expect(constraintMarkup({ kind: "range", target, max: 1, maxInclusive: false })).toBe(
    "` x ` $<$ $1$",
  );
});
