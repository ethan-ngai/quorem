import { describe, expect, it } from "vitest";
import type { Constraint, Signature } from "@quorem/contracts";
import { bindArguments } from "./argumentBinding";
import { formatBound, formatConstraint } from "./constraintFormatter";
import { validateConstraints } from "./constraintValidation";
import { parseCustomDraft } from "./customCases";

const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [
    { name: "values", type: "list<int>" },
    { name: "limit", type: "int" },
  ],
  returnType: "int",
};
const constraints: Constraint[] = [
  { kind: "range", target: { parameter: "values", projection: "length" }, min: 1, max: 10_000 },
  {
    kind: "comparison",
    left: { parameter: "values", projection: "length" },
    right: { parameter: "limit", projection: "value" },
    operator: "le",
  },
  {
    kind: "property",
    target: { parameter: "values", projection: "elements" },
    property: "nondecreasing",
  },
];

describe("structured constraints", () => {
  it("revalidates unchanged authoring cases when constraints change", () => {
    const draft = { id: "one", args: ["[1,2]", "3"], expectedEnabled: true, expected: "0" };
    expect(() => parseCustomDraft(draft, signature, constraints)).not.toThrow();
    const stricter: Constraint[] = [
      { kind: "range", target: { parameter: "values", projection: "length" }, max: 1 },
    ];
    expect(() => parseCustomDraft(draft, signature, stricter)).toThrow(/Constraint \d+:/);
    expect(() => parseCustomDraft(draft, signature, [])).not.toThrow();
  });
  it("formats data without inspecting prose", () => {
    expect(formatConstraint(constraints[0]!)).toBe("1 ≤ values.length ≤ 10^4");
    expect(
      formatConstraint({
        kind: "range",
        target: { parameter: "head", projection: "nodeValues" },
        min: -2147483648,
        max: 2147483647,
      }),
    ).toBe("-2^31 ≤ node.val ≤ 2^31 - 1 (nodes in head)");
    expect(
      formatConstraint({
        kind: "property",
        target: { parameter: "root", projection: "nodeValues" },
        property: "unique",
      }),
    ).toBe("Node values in root are unique");
    expect(formatBound(-2147483648)).toBe("-2^31");
    expect(formatBound(2147483647)).toBe("2^31 - 1");
    expect(formatConstraint({ kind: "prose", text: "At most 10,000 collection elements." })).toBe(
      "At most 10,000 collection elements.",
    );
  });
  it("admits ordered values and rejects each violated rule", () => {
    expect(() => validateConstraints(signature, [[1, 2], 2], constraints)).not.toThrow();
    for (const args of [
      [[], 2],
      [[1, 2], 1],
      [[2, 1], 2],
    ])
      expect(() => validateConstraints(signature, args, constraints)).toThrow(/Constraint \d+:/);
  });
  it("counts Unicode codepoints and excludes null tree slots", () => {
    const nodes: Signature = {
      ...signature,
      parameters: [
        { name: "root", type: "TreeNode" },
        { name: "text", type: "str" },
      ],
    };
    expect(() =>
      validateConstraints(
        nodes,
        [[1, null, 2], "😀"],
        [
          { kind: "range", target: { parameter: "root", projection: "nodeCount" }, max: 2 },
          { kind: "range", target: { parameter: "text", projection: "length" }, max: 1 },
          {
            kind: "range",
            target: { parameter: "root", projection: "nodeValues" },
            min: 1,
            max: 2,
          },
        ],
      ),
    ).not.toThrow();
  });
  it("checks Unicode uniqueness and null node targets", () => {
    const signature: Signature = {
      className: "Solution",
      methodName: "solve",
      parameters: [
        { name: "text", type: "str" },
        { name: "root", type: "TreeNode" },
      ],
      returnType: "int",
    };
    const constraints: Constraint[] = [
      { kind: "property", target: { parameter: "text", projection: "value" }, property: "unique" },
      { kind: "range", target: { parameter: "root", projection: "nodeCount" }, min: 0, max: 0 },
    ];
    expect(() => validateConstraints(signature, ["😀😁", null], constraints)).not.toThrow();
    expect(() => validateConstraints(signature, ["😀😀", null], constraints)).toThrow(
      /Constraint \d+:/,
    );
    expect(() =>
      validateConstraints(
        {
          ...signature,
          parameters: [
            { name: "text", type: "optional<str>" },
            { name: "root", type: "TreeNode" },
          ],
        },
        [null, null],
        constraints,
      ),
    ).toThrow(/projection value invalid for optional/);
  });
  it("renders and admits numeric totals as scalar targets", () => {
    const sum: Constraint = {
      kind: "range",
      target: { parameter: "values", projection: "sum" },
      max: 2147483647,
    };
    expect(formatConstraint(sum)).toBe("sum(values) ≤ 2^31 - 1");
    expect(() =>
      parseCustomDraft(
        { id: "case", args: ["[2147483647,1]", "2"], expectedEnabled: false, expected: "" },
        signature,
        [sum],
      ),
    ).toThrow(/Constraint \d+:/);
    const comparison: Constraint = {
      kind: "comparison",
      left: { parameter: "values", projection: "sum" },
      right: { parameter: "limit", projection: "value" },
      operator: "le",
    };
    expect(() => validateConstraints(signature, [[1, 2], 3], [comparison])).not.toThrow();
    expect(() => validateConstraints(signature, [[1, 2], 2], [comparison])).toThrow(
      /Constraint \d+:/,
    );
  });
  it("validates admitted custom drafts", () => {
    expect(() =>
      parseCustomDraft(
        { id: "case", args: ["[2,1]", "2"], expectedEnabled: false, expected: "" },
        signature,
        constraints,
      ),
    ).toThrow(/Constraint \d+:/);
  });
});

describe("signature binding", () => {
  it("retains names, types, values and rejects both arity mismatches", () => {
    expect(bindArguments(signature, [[1], 2])).toEqual([
      { name: "values", type: "list<int>", value: [1] },
      { name: "limit", type: "int", value: 2 },
    ]);
    expect(() => bindArguments(signature, [[1]])).toThrow("Wrong argument count");
    expect(() => bindArguments(signature, [[1], 2, 3])).toThrow("Wrong argument count");
  });
});

it("uses strict range boundaries in client validation and diagnostic text", () => {
  const float: Signature = {
    className: "Solution",
    methodName: "solve",
    parameters: [{ name: "x", type: "float" }],
    returnType: "int",
  };
  const rule: Constraint = {
    kind: "range",
    target: { parameter: "x", projection: "value" },
    min: 0.25,
    max: 0.75,
    minInclusive: false,
    maxInclusive: false,
  };
  expect(formatConstraint(rule)).toBe("0.25 < x < 0.75");
  expect(() => validateConstraints(float, [0.5], [rule])).not.toThrow();
  expect(() => validateConstraints(float, [0.25], [rule])).toThrow("0.25 < x < 0.75");
  expect(() => validateConstraints(float, [0.75], [rule])).toThrow("0.25 < x < 0.75");
  const long: Signature = { ...float, parameters: [{ name: "x", type: "long" }] };
  const lower: Constraint = {
    kind: "range",
    target: rule.target,
    min: Number.MAX_SAFE_INTEGER,
    minInclusive: false,
  };
  expect(() => validateConstraints(long, ["9007199254740992"], [lower])).not.toThrow();
  expect(() => validateConstraints(long, ["9007199254740991"], [lower])).toThrow(/Constraint \d+:/);
});

it("matches quantified comparisons and DESC ordering with server semantics", () => {
  const comparison: Constraint = {
    kind: "comparison",
    left: { parameter: "values", projection: "elements" },
    right: { parameter: "limit", projection: "value" },
    operator: "lt",
  };
  expect(() => validateConstraints(signature, [[1, 4], 3], [comparison])).toThrow();
  expect(() =>
    validateConstraints(signature, [[1, 4], 3], [{ ...comparison, quantifier: "any" }]),
  ).not.toThrow();
  expect(() =>
    validateConstraints(signature, [[], 3], [{ ...comparison, quantifier: "any" }]),
  ).toThrow();
  const order: Constraint = {
    kind: "property",
    target: { parameter: "values", projection: "elements" },
    property: "nondecreasing",
    direction: "desc",
  };
  expect(() => validateConstraints(signature, [[4, 2, 2], 3], [order])).not.toThrow();
  expect(() => validateConstraints(signature, [[2, 4], 3], [order])).toThrow();
  expect(formatConstraint(order)).toContain("nonincreasing");
  expect(formatConstraint({ ...comparison, quantifier: "any" })).toContain("∃");
});
