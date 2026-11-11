import { describe, expect, it } from "vitest";
import { constraintListMarkup, constraintMarkup } from "./constraintMarkup";

describe("constraint Markdown composition", () => {
  it("keeps indexed accesses in code and typesets the numeric bounds", () => {
    expect(
      constraintMarkup({
        kind: "range",
        target: { parameter: "loads", projection: "elements" },
        min: -10000,
        max: 2147483647,
      }),
    ).toBe("$-10^{4} \\le$ ` loads[i] ` $\\le 2^{31} - 1$");
  });
  it("composes comparisons and node ownership from metadata", () => {
    expect(
      constraintMarkup({
        kind: "comparison",
        left: { parameter: "a", projection: "length" },
        operator: "lt",
        right: { parameter: "b", projection: "sum" },
      }),
    ).toBe("` a.length ` $<$ ` sum(b) `");
    expect(
      constraintMarkup({
        kind: "range",
        target: { parameter: "root", projection: "nodeValues" },
        min: 0,
      }),
    ).toBe("` node.val ` $\\ge 0$ (nodes in ` root `)");
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
    "$0 < x \\le 1$",
  );
  expect(constraintMarkup({ kind: "range", target, min: 0, max: 1, maxInclusive: false })).toBe(
    "$0 \\le x < 1$",
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
  ).toBe("$0 < x < 1$");
  expect(constraintMarkup({ kind: "range", target, min: 0, minInclusive: false })).toBe("$x > 0$");
  expect(constraintMarkup({ kind: "range", target, max: 1, maxInclusive: false })).toBe("$x < 1$");
});

it("shows existential quantification and descending order in public content", () => {
  expect(
    constraintMarkup({
      kind: "comparison",
      left: { parameter: "a", projection: "elements" },
      right: { parameter: "n", projection: "value" },
      operator: "lt",
      quantifier: "any",
    }),
  ).toContain("$\\exists");
  expect(
    constraintMarkup({
      kind: "property",
      target: { parameter: "a", projection: "elements" },
      property: "nondecreasing",
      direction: "desc",
    }),
  ).toContain("nonincreasing");
});

it("chains scalar bounds and keeps strict endpoints when reversing a comparison", () => {
  const left = { parameter: "ax1", projection: "value" } as const;
  const right = { parameter: "ax2", projection: "value" } as const;
  expect(
    constraintListMarkup([
      { kind: "comparison", left: right, right: left, operator: "gt" },
      { kind: "range", target: left, min: -10000, minInclusive: false },
      { kind: "range", target: right, max: 10000 },
    ]),
  ).toEqual(["$-10^{4} <$ ` ax1 ` $<$ ` ax2 ` $\\le 10^{4}$"]);
});

it("groups identical scalar bounds and leaves independent existential rules separate", () => {
  const target = (parameter: string) => ({ parameter, projection: "value" as const });
  expect(
    constraintListMarkup([
      { kind: "range", target: target("width"), min: 1, max: 100 },
      { kind: "range", target: target("height"), min: 1, max: 100 },
      { kind: "range", target: target("x"), min: 1, max: 100, quantifier: "any" },
    ]),
  ).toEqual(["$1 \\le$ ` width `, ` height ` $\\le 100$", "$\\exists\\,:\\; 1 \\le x \\le 100$"]);
});

it("renders sets and row dimensions as math around typed code accesses", () => {
  expect(
    constraintMarkup({
      kind: "membership",
      target: { parameter: "grid", projection: "value", path: ["each", "each"] },
      values: [0, 1],
    }),
  ).toBe("` grid[i][j] ` $\\in \\{ 0, 1 \\}$");
  expect(
    constraintMarkup({
      kind: "membership",
      target: { parameter: "text", projection: "characters" },
      values: ["0", "1"],
    }),
  ).toBe('` text[i] ` $\\in \\{$ ` "0" `, ` "1" ` $\\}$');
  expect(
    constraintMarkup({
      kind: "definition",
      name: "m",
      target: { parameter: "grid", projection: "length", path: ["each"] },
    }),
  ).toBe("$m =$ ` grid[i].length `");
});

it("describes ordering separately for each matrix column", () => {
  expect(
    constraintMarkup({
      kind: "property",
      target: { parameter: "matrix", projection: "columns" },
      property: "nondecreasing",
    }),
  ).toBe("Each column of ` matrix ` is in nondecreasing order");
});
