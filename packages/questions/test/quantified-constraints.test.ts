import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  comparisonMatches,
  comparisonChoices,
  constraintTargetOptions,
  propertyMatches,
  rangeMatches,
  validateCodingCase,
  validateConstraints,
  validateQuestionSchema,
} from "../src/index.ts";
import type { Constraint, Signature } from "../src/index.ts";

const sig: Signature = {
  className: "Solution",
  methodName: "solve",
  returnType: "int",
  parameters: [
    { name: "values", type: "list<int>" },
    { name: "count", type: "int" },
  ],
};
const comparison = {
  kind: "comparison",
  left: { parameter: "values", projection: "elements" },
  right: { parameter: "count", projection: "value" },
  operator: "lt",
} satisfies Constraint;
const range = { kind: "range", target: comparison.left, min: 0, max: 10 } satisfies Constraint;

it("broadcasts scalar comparisons to every value or at least one value", () => {
  expect(() => validateConstraints(sig, [comparison])).not.toThrow();
  expect(() =>
    validateCodingCase(sig, [comparison], '{"args":[[1,2],3],"expected":0}'),
  ).not.toThrow();
  expect(() => validateCodingCase(sig, [comparison], '{"args":[[1,4],3],"expected":0}')).toThrow(
    /comparison/,
  );
  expect(() =>
    validateCodingCase(
      sig,
      [{ ...comparison, quantifier: "any" }],
      '{"args":[[1,4],3],"expected":0}',
    ),
  ).not.toThrow();
  expect(comparisonMatches(comparison, [], [3])).toBe(true);
  expect(comparisonMatches({ ...comparison, quantifier: "any" }, [], [3])).toBe(false);
});

it("quantifies every pair without rounding long values", () => {
  expect(comparisonMatches(comparison, [1, 2], [3, 4])).toBe(true);
  expect(comparisonMatches(comparison, [1, 3], [2, 4])).toBe(false);
  expect(comparisonMatches({ ...comparison, quantifier: "any" }, [1, 3], [2, 4])).toBe(true);
  expect(
    comparisonMatches({ ...comparison, operator: "gt" }, [9007199254740993n], [9007199254740992]),
  ).toBe(true);
  expect(
    comparisonMatches({ ...comparison, operator: "eq", quantifier: "any" }, [1n, 5n], [1, 3]),
  ).toBe(true);
  for (const operator of ["eq", "le", "lt", "ge", "gt"] as const) {
    for (const quantifier of ["all", "any"] as const) {
      const left = [0, 2, 4],
        right = [1, 2, 3];
      const matches = left.flatMap((a) =>
        right.map((b) => ({ eq: a === b, le: a <= b, lt: a < b, ge: a >= b, gt: a > b })[operator]),
      );
      expect(comparisonMatches({ ...comparison, operator, quantifier }, left, right)).toBe(
        quantifier === "all" ? matches.every(Boolean) : matches.some(Boolean),
      );
    }
  }
});

it("supports existential ranges including empty sequences", () => {
  expect(rangeMatches(range, [-1, 3])).toBe(false);
  expect(rangeMatches({ ...range, quantifier: "any" }, [-1, 3])).toBe(true);
  expect(rangeMatches({ ...range, quantifier: "any" }, [])).toBe(false);
  expect(rangeMatches(range, [])).toBe(true);
});

it("checks ASC/DESC ordering and disallows direction on uniqueness", () => {
  const rule = {
    kind: "property",
    target: comparison.left,
    property: "nondecreasing",
  } satisfies Constraint;
  expect(propertyMatches(rule, [1, 2, 2])).toBe(true);
  expect(propertyMatches({ ...rule, direction: "desc" }, [3, 2, 2])).toBe(true);
  expect(propertyMatches({ ...rule, direction: "desc" }, [2, 3])).toBe(false);
  expect(() =>
    validateCodingCase(sig, [{ ...rule, direction: "desc" }], '{"args":[[3,2,2],3],"expected":0}'),
  ).not.toThrow();
  expect(() =>
    validateConstraints(sig, [{ ...rule, property: "unique", direction: "desc" }]),
  ).toThrow(/direction/);
});

it("retains quantifiers and direction in canonical import validation", () => {
  const content = JSON.parse(
    readFileSync(new URL("../../contracts/questions/example-v1.json", import.meta.url), "utf8"),
  );
  content.problem.constraints = [
    { ...comparison, quantifier: "any" },
    { kind: "property", target: comparison.left, property: "sorted", direction: "desc" },
  ];
  expect(() => validateQuestionSchema(JSON.stringify(content))).not.toThrow();
  content.problem.constraints[0].quantifier = "unknown";
  expect(() => validateQuestionSchema(JSON.stringify(content))).toThrow(/schema/);
});

it("compares every or some node value against its tree's node count", () => {
  const tree: Signature = { ...sig, parameters: [{ name: "root", type: "TreeNode" }] };
  const rule: Constraint = {
    kind: "comparison",
    left: { parameter: "root", projection: "nodeValues" },
    right: { parameter: "root", projection: "nodeCount" },
    operator: "lt",
  };
  const json = '{"args":[[1,4,2]],"expected":0}';
  expect(() => validateCodingCase(tree, [rule], json)).toThrow(/comparison/);
  expect(() => validateCodingCase(tree, [{ ...rule, quantifier: "any" }], json)).not.toThrow();
});

it("rejects scalar reflexivity and admits only meaningful sequence self-comparisons", () => {
  for (const quantifier of ["all", "any"] as const)
    for (const operator of ["eq", "le", "lt", "ge", "gt"] as const) {
      const self: Constraint = {
        ...comparison,
        left: comparison.right,
        right: comparison.right,
        operator,
        quantifier,
      };
      expect(() => validateConstraints(sig, [self])).toThrow(/itself/);
      const sequence: Constraint = { ...comparison, right: comparison.left, operator, quantifier };
      const meaningful =
        quantifier === "any"
          ? ["lt", "gt"].includes(operator)
          : ["eq", "le", "ge"].includes(operator);
      if (meaningful) expect(() => validateConstraints(sig, [sequence])).not.toThrow();
      else expect(() => validateConstraints(sig, [sequence])).toThrow();
    }
  const allEqual: Constraint = { ...comparison, right: comparison.left, operator: "eq" };
  expect(() =>
    validateCodingCase(sig, [allEqual], '{"args":[[2,2],3],"expected":0}'),
  ).not.toThrow();
  expect(() => validateCodingCase(sig, [allEqual], '{"args":[[1,2],3],"expected":0}')).toThrow();
  const distinct: Constraint = { ...allEqual, operator: "lt", quantifier: "any" };
  expect(() =>
    validateCodingCase(sig, [distinct], '{"args":[[1,2],3],"expected":0}'),
  ).not.toThrow();
  expect(() => validateCodingCase(sig, [distinct], '{"args":[[2,2],3],"expected":0}')).toThrow();
});

it("derives compatible choices for arbitrary typed variables from admission rules", () => {
  const signature: Signature = {
    ...sig,
    parameters: [
      { name: "count", type: "int" },
      { name: "values", type: "list<int>" },
      { name: "tree", type: "TreeNode" },
      { name: "limit", type: "long" },
    ],
  };
  const targets = constraintTargetOptions(signature, "comparison");
  expect(new Set(targets.map((target) => target.parameter))).toEqual(
    new Set(["count", "values", "tree", "limit"]),
  );
  for (const left of targets)
    for (const right of targets)
      for (const quantifier of ["all", "any"] as const)
        for (const operator of ["eq", "le", "lt", "ge", "gt"] as const) {
          const rule: Constraint = { kind: "comparison", left, right, operator, quantifier };
          const choices = comparisonChoices(signature, rule);
          for (const target of choices.left)
            expect(() => validateConstraints(signature, [{ ...rule, left: target }])).not.toThrow();
          for (const target of choices.right)
            expect(() =>
              validateConstraints(signature, [{ ...rule, right: target }]),
            ).not.toThrow();
          for (const mode of choices.modes)
            expect(() => validateConstraints(signature, [{ ...rule, ...mode }])).not.toThrow();
        }
  const rule: Constraint = {
    kind: "comparison",
    left: { parameter: "tree", projection: "nodeCount" },
    right: { parameter: "tree", projection: "nodeValues" },
    operator: "le",
  };
  expect(comparisonChoices(signature, rule).right).not.toContainEqual(rule.left);
  expect(comparisonChoices(signature, rule).right).toContainEqual({
    parameter: "count",
    projection: "value",
  });
});

it("keeps the same compatibility policy across sixteen independent scalar inputs", () => {
  const signature: Signature = {
    ...sig,
    parameters: Array.from({ length: 16 }, (_, i) => ({ name: `v${i}`, type: "int" })),
  };
  const rule: Constraint = {
    kind: "comparison",
    left: { parameter: "v0", projection: "value" },
    right: { parameter: "v1", projection: "value" },
    operator: "lt",
  };
  const choices = comparisonChoices(signature, rule);
  expect(choices.left).toHaveLength(15);
  expect(choices.right).toHaveLength(15);
  expect(choices.left).not.toContainEqual(rule.right);
  expect(choices.right).not.toContainEqual(rule.left);
  expect(choices.right).toContainEqual({ parameter: "v15", projection: "value" });
});
