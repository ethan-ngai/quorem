import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signature } from "@quorem/contracts";
import { ConstraintFields } from "./ConstraintFields";
import { constraintTargets, MathOperator } from "./ConstraintInputs";

const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  returnType: "int",
  parameters: [
    { name: "root", type: "TreeNode" },
    { name: "nums", type: "list<int>" },
    { name: "text", type: "str" },
  ],
};

it("offers measurements appropriate to the rule and parameter", () => {
  const ranges = constraintTargets(signature, "range");
  expect(ranges).toContainEqual({ parameter: "root", projection: "nodeCount" });
  expect(ranges).toContainEqual({ parameter: "root", projection: "nodeValues" });
  expect(ranges).not.toContainEqual({ parameter: "root", projection: "length" });
  expect(ranges).not.toContainEqual({ parameter: "text", projection: "value" });
  expect(constraintTargets(signature, "comparison")).not.toContainEqual({
    parameter: "nums",
    projection: "elements",
  });
  expect(constraintTargets(signature, "property")).toContainEqual({
    parameter: "text",
    projection: "value",
  });
  expect(constraintTargets(signature, "property")).not.toContainEqual({
    parameter: "root",
    projection: "nodeCount",
  });
  expect(constraintTargets(undefined, "range")).toEqual([]);
});

it("renders a range as an expression with machine typography, without schema controls", () => {
  const html = renderToStaticMarkup(
    <ConstraintFields
      signature={signature}
      disabled={false}
      onChange={() => {}}
      value={[
        {
          kind: "range",
          target: { parameter: "root", projection: "nodeCount" },
          min: 0,
          max: 10000,
        },
      ]}
    />,
  );
  expect(html).toContain('role="radio" aria-label="root"');
  expect(html).toContain('aria-label="Node count"');
  expect(html).not.toContain('role="combobox"');
  expect(html).toContain('class="constraint-kind" aria-label="Range"');
  expect(html).toContain('data-mono="true"');
  expect(html).toContain('aria-label="Constraint 1 minimum"');
  expect(html).not.toContain("Rule type");
  expect(html).not.toContain("Measure</");
});

it("renders independent endpoint inclusivity and real LaTeX relation glyphs", () => {
  const html = renderToStaticMarkup(
    <ConstraintFields
      signature={signature}
      disabled={false}
      onChange={() => {}}
      value={[
        {
          kind: "range",
          target: { parameter: "root", projection: "nodeCount" },
          min: 0,
          max: 10,
          minInclusive: false,
        },
      ]}
    />,
  );
  expect(html).toContain('aria-label="Include constraint 1 lower bound" aria-pressed="false"');
  expect(html).toContain('aria-label="Include constraint 1 upper bound" aria-pressed="true"');
  const math = renderToStaticMarkup(<MathOperator source={"\\le"} />);
  expect(math).toContain("<mo>≤</mo>");
});
