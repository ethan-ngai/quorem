import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuestionContent, ProblemVersion } from "@quorem/contracts";
import fixture from "../../../../../fixtures/problems/level-spreads.json";
import {
  caseValidationIssues,
  updateAuthoringIssues,
  authoringMessages,
} from "./authoringValidation";
import { ConstraintFields } from "./ConstraintFields";
import { TestCases } from "../editor/components/TestCases";
import type { CustomCaseDraft } from "../editor/customCases";

const content = structuredClone(fixture) as QuestionContent;
const rule = content.problem.constraints[1]!;
if (rule.kind !== "range") throw new Error("Expected node-value range fixture");
rule.quantifier = "any";
const problem = content.problem;
function drafts(cases: typeof content.hiddenCases): CustomCaseDraft[] {
  return cases.map((test, index) => ({
    id: `case-${index}`,
    args: test.args.map((arg) => JSON.stringify(arg)),
    expectedEnabled: true,
    expected: JSON.stringify(test.expected),
  }));
}

it("identifies the actual example/private test and the originating constraint", () => {
  const publicIssues = caseValidationIssues(drafts(problem.examples), problem, "Example");
  const privateIssues = caseValidationIssues(drafts(content.hiddenCases), problem, "Private test");
  expect(publicIssues).toHaveLength(1);
  expect(privateIssues).toHaveLength(2);
  expect(publicIssues[0]).toMatchObject({ constraintIndex: 1, parameters: ["root"] });
  expect(publicIssues[0]!.message).toContain("Example 3: Constraint 2: root is empty");
  expect(publicIssues[0]!.message).toContain("∃ needs a matching value");
  expect(privateIssues[0]!.message).toContain("Private test 1:");
  expect(privateIssues[1]!.message).toContain("Private test 2:");
  const all = structuredClone(problem);
  const range = all.constraints[1]!;
  if (range.kind === "range") range.quantifier = undefined;
  expect(caseValidationIssues(drafts(problem.examples), all, "Example")).toEqual([]);
});

it("shows the same descriptive issue at the constraint, case and input", () => {
  const cases = drafts(problem.examples);
  const issues = caseValidationIssues(cases, problem, "Example");
  const fields = renderToStaticMarkup(
    <ConstraintFields
      value={problem.constraints}
      signature={problem.signature}
      validationIssues={issues}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(fields).toContain('aria-label="Check constraint 2"');
  expect(fields).toContain("Example 3: Constraint 2: root is empty");
  const caseEditor = renderToStaticMarkup(
    <TestCases
      problem={{ ...problem, starterSource: "", runtimeRevision: "fixture" } as ProblemVersion}
      customMode
      drafts={cases}
      selectedCustomId="case-2"
      onDraftsChange={() => {}}
    />,
  );
  expect(caseEditor).toContain('aria-label="Check case 3"');
  expect(caseEditor).toContain('aria-label="Check root"');
  expect(caseEditor).toContain('aria-invalid="true"');
  expect(caseEditor).toContain("root is empty");
});

it("keeps concurrent origins until each conflict is resolved", () => {
  const issue = caseValidationIssues(drafts(problem.examples), problem, "Example")[0]!;
  let state = updateAuthoringIssues(new Map(), "examples", true, [issue]);
  state = updateAuthoringIssues(state, "private-tests", true, [
    { ...issue, message: `Private test 1: ${issue.message}` },
  ]);
  expect(state.size).toBe(2);
  state = updateAuthoringIssues(state, "examples", false);
  expect(state.size).toBe(1);
  expect(state.get("private-tests")?.[0]?.constraintIndex).toBe(1);
  const unchanged = updateAuthoringIssues(state, "examples", false);
  expect(unchanged).toBe(state);
  expect(updateAuthoringIssues(state, "private-tests", false).size).toBe(0);
});

it("groups one conflict while listing all affected origins", () => {
  const issues = [
    ...caseValidationIssues(drafts(problem.examples), problem, "Example"),
    ...caseValidationIssues(drafts(content.hiddenCases), problem, "Private test"),
  ];
  const messages = authoringMessages(issues);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("Example 3, Private test 1, Private test 2: Constraint 2");
  expect(messages[0]!.match(/is empty/g)).toHaveLength(1);
});
