import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Signature } from "@quorem/contracts";
import { SignatureFields } from "./SignatureFields";

const signature: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [{ name: "root", type: "TreeNode" }],
  returnType: "int",
};
const render = (value: Signature) =>
  renderToStaticMarkup(<SignatureFields value={value} onChange={() => {}} />);

it("offers node input modes without an incompatible return identity option", () => {
  const markup = render(signature);
  expect(markup).toContain('aria-label="Node identity"');
  expect(markup).toContain('aria-label="Independent" aria-checked="true"');
  expect(markup).toContain('aria-label="Shared inputs"');
  expect(markup).not.toContain('aria-label="Return identity"');
});

it("exposes return identity for a matching node return type", () => {
  const markup = render({ ...signature, returnType: "TreeNode", nodeReferences: "return" });
  expect(markup).toContain('aria-label="Return identity" aria-checked="true"');
});

it("omits node identity for scalar signatures", () => {
  expect(render({ ...signature, parameters: [{ name: "count", type: "int" }] })).not.toContain(
    'aria-label="Node identity"',
  );
});
