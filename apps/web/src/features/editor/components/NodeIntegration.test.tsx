import { primarySignature } from "@quorem/questions";
/** @file NodeIntegration.test.tsx @description Question and authoring surfaces share one contextual diagram per case. @module editor */
import { stripSyntaxMarkup } from "../../../test/stripSyntaxMarkup";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { blankQuestion } from "../../admin/content";
import { AuthoringCases } from "../../admin/AuthoringCases";
import { PublicPreview } from "../../admin/QuestionFields";
import { SequenceTestsEditor } from "../../odyssey/SequenceTestsEditor";
import { createCustomDraft } from "../customCases";
import { ProblemStatement } from "./ProblemStatement";
import { TestCases } from "./TestCases";

const content = blankQuestion();
content.problem.signature = {
  className: "Solution",
  methodName: "select",
  nodeReferences: "return",
  parameters: [
    { name: "root", type: "NaryTreeNode" },
    { name: "p", type: "NaryTreeNode" },
  ],
  returnType: "NaryTreeNode",
};
content.problem.examples = [
  { args: [[1, null, 3, 2, 4, null, 5, 6], { ref: [0, 4] }], expected: { ref: [0, 1] } },
];
content.hiddenCases = [{ args: [[987654321], null], expected: null }];
const problem = content.problem;
const draft = { ...createCustomDraft(problem), expectedEnabled: true };
const method = { id: "method", signature: primarySignature(problem) };
const sequence = { id: "sequence", calls: [{ id: "call", methodId: method.id, values: draft }] };

it.each([
  ["question examples", <ProblemStatement problem={problem} />],
  ["admin public preview", <PublicPreview content={content} />],
  [
    "question custom cases",
    <TestCases problem={problem} customMode drafts={[draft]} onDraftsChange={() => {}} />,
  ],
  [
    "admin case authoring",
    <AuthoringCases content={content} onChange={() => {}} onValidityChange={() => {}} />,
  ],
  [
    "staged case authoring",
    <SequenceTestsEditor
      methods={[method]}
      value={[sequence]}
      onChange={() => {}}
      label="Examples"
      onSelect={() => {}}
    />,
  ],
])("integrates the shared preview in %s", (_, view) => {
  const html = renderToStaticMarkup(view);
  expect(html.match(/aria-label="Test case diagram"/g)).toHaveLength(1);
  expect(stripSyntaxMarkup(html)).toContain("root[1]");
  expect(html).not.toContain("987654321");
});

it("retains one diagram when a question result is shown alongside its inputs", () => {
  const html = renderToStaticMarkup(
    <TestCases
      problem={problem}
      customMode={false}
      drafts={[]}
      onDraftsChange={() => {}}
      caseResults={[
        { index: 0, status: "wrong_answer", actual: { ref: [0, 2] }, expected: { ref: [0, 1] } },
      ]}
    />,
  );
  expect(html.match(/aria-label="Test case diagram"/g)).toHaveLength(1);
  expect(html).toContain("wrong answer");
});

it("keeps inputs and run output inside the same value stack before its diagram", () => {
  const html = renderToStaticMarkup(
    <TestCases
      problem={problem}
      customMode={false}
      drafts={[]}
      onDraftsChange={() => {}}
      caseResults={[
        { index: 0, status: "runtime_error", diagnostics: [{ line: 6, message: "Invalid node" }] },
      ]}
    />,
  );
  expect(html).toMatch(
    /case-preview-values[\s\S]*case-call-inputs[\s\S]*case-run-output[\s\S]*aria-label="Test case diagram"/,
  );
  expect(html.indexOf("Line 6: Invalid node")).toBeLessThan(html.indexOf("case-preview-values"));
  expect(html.match(/class="case-verdict-group"/g)).toHaveLength(1);
  expect(html.match(/aria-label="Test case diagram"/g)).toHaveLength(1);
});
