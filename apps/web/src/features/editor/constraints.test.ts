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
    expect(() => parseCustomDraft(draft, signature, stricter)).toThrow("Constraint:");
    expect(() => parseCustomDraft(draft, signature, [])).not.toThrow();
  });
  it("formats data without inspecting prose", () => {
    expect(formatConstraint(constraints[0]!)).toBe("1 ≤ len(values) ≤ 10^4");
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
      expect(() => validateConstraints(signature, args, constraints)).toThrow("Constraint:");
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
      "Constraint:",
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
    ).toThrow("Unsupported constraint target");
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
    ).toThrow("Constraint:");
    const comparison: Constraint = {
      kind: "comparison",
      left: { parameter: "values", projection: "sum" },
      right: { parameter: "limit", projection: "value" },
      operator: "le",
    };
    expect(() => validateConstraints(signature, [[1, 2], 3], [comparison])).not.toThrow();
    expect(() => validateConstraints(signature, [[1, 2], 2], [comparison])).toThrow("Constraint:");
  });
  it("validates admitted custom drafts", () => {
    expect(() =>
      parseCustomDraft(
        { id: "case", args: ["[2,1]", "2"], expectedEnabled: false, expected: "" },
        signature,
        constraints,
      ),
    ).toThrow("Constraint:");
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
