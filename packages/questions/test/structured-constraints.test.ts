import { expect, it } from "vitest";
import {
  structuredConstraintSuggestion,
  validateCodingCase,
  validateConstraints,
  type Constraint,
  type Signature,
} from "../src/index.ts";

const signature = (...parameters: Signature["parameters"]): Signature => ({
  className: "Solution",
  methodName: "solve",
  returnType: "int",
  parameters,
});
const gridSignature = signature({ name: "grid", type: "list<list<int>>" });
const cells = { parameter: "grid", projection: "value", path: ["each", "each"] } as const;
const rows = { parameter: "grid", projection: "length", path: ["each"] } as const;

it("enforces finite sets, rectangular dimensions and uniqueness within each row", () => {
  const rules: Constraint[] = [
    { kind: "definition", name: "m", target: { ...rows, path: [...rows.path] } },
    { kind: "membership", target: { ...cells, path: [...cells.path] }, values: [0, 1] },
    {
      kind: "property",
      property: "unique",
      target: { parameter: "grid", projection: "elements", path: ["each"] },
    },
  ];
  const check = (grid: number[][]) =>
    validateCodingCase(gridSignature, rules, JSON.stringify({ args: [grid] }), false);
  expect(() =>
    check([
      [0, 1],
      [1, 0],
    ]),
  ).not.toThrow();
  expect(() => check([[0], [1, 0]])).toThrow("constraint 1");
  expect(() =>
    check([
      [0, 1],
      [0, 2],
    ]),
  ).toThrow("constraint 2");
  expect(() =>
    check([
      [0, 1],
      [0, 0],
    ]),
  ).toThrow("constraint 3");
});

it("compares columns at matching positions and reports missing fixed indices", () => {
  const rule: Constraint = {
    kind: "comparison",
    left: { parameter: "grid", path: ["each", 0], projection: "value" },
    right: { parameter: "grid", path: ["each", 1], projection: "value" },
    operator: "lt",
    pairing: "corresponding",
  };
  const check = (grid: number[][]) =>
    validateCodingCase(gridSignature, [rule], JSON.stringify({ args: [grid] }), false);
  expect(() =>
    check([
      [1, 3],
      [5, 7],
    ]),
  ).not.toThrow();
  expect(() =>
    check([
      [1, 3],
      [7, 5],
    ]),
  ).toThrow("constraint 1");
  expect(() => check([[1], [5, 7]])).toThrow("index 1 is missing");
});

it("keeps exact integer arithmetic and validates typed alphabet literals", () => {
  const sig = signature({ name: "x", type: "long" }, { name: "s", type: "str" });
  const rules: Extract<Constraint, { kind: "membership" }>[] = [
    {
      kind: "membership",
      target: { parameter: "s", projection: "characters" },
      values: ["a", "😀"],
    },
    {
      kind: "membership",
      target: {
        parameter: "x",
        projection: "value",
        operations: [{ operator: "add", operand: 1 }],
      },
      values: ["9007199254740993"],
    },
  ];
  const check = (x: string, s: string) =>
    validateCodingCase(sig, rules, JSON.stringify({ args: [x, s] }), false);
  expect(() => check("9007199254740992", "a😀")).not.toThrow();
  expect(() => check("9007199254740991", "a😀")).toThrow("constraint 2");
  expect(() => check("9007199254740992", "b")).toThrow("constraint 1");
  expect(() => validateConstraints(sig, [{ ...rules[0], values: [0, 1] }])).toThrow("str literals");
});

it("checks graph topology independently of edge values or edge orientation in the native list", () => {
  const sig = signature({ name: "edges", type: "list<list<int>>" });
  sig.graphEncodings = { edges: { kind: "edgeList", directed: false, edgeValue: "weight" } };
  const target = { parameter: "edges", projection: "graph" } as const;
  const rules: Constraint[] = [
    { kind: "property", target, property: "noParallelEdges" },
    { kind: "property", target, property: "tree" },
  ];
  const check = (edges: number[][]) =>
    validateCodingCase(sig, rules, JSON.stringify({ args: [edges] }), false);
  expect(() =>
    check([
      [0, 1, 4],
      [1, 2, 2],
    ]),
  ).not.toThrow();
  expect(() => check([])).not.toThrow();
  expect(() =>
    check([
      [0, 1, 4],
      [1, 0, 2],
    ]),
  ).toThrow("constraint 1");
  expect(() =>
    check([
      [0, 1, 4],
      [2, 3, 2],
    ]),
  ).toThrow("constraint 2");
});

it("offers exact prose conversions and avoids interpreting a repeated index as all cells", () => {
  expect(structuredConstraintSuggestion(gridSignature, "`grid[i][j]` $\\in \\{0, 1\\}$")).toEqual({
    kind: "membership",
    target: cells,
    values: [0, 1],
  });
  expect(
    structuredConstraintSuggestion(gridSignature, "$1 \\le$ `grid[i][j]` $< 50$"),
  ).toMatchObject({
    kind: "range",
    target: cells,
    min: 1,
    max: 50,
    maxInclusive: false,
  });
  expect(
    structuredConstraintSuggestion(gridSignature, "$1 \\le$ `grid[i][i]` $< 50$"),
  ).toBeUndefined();
  expect(
    structuredConstraintSuggestion(gridSignature, "There is exactly one island in `grid`."),
  ).toBeUndefined();
});
