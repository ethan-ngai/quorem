/** @file WorkspaceTests.test.tsx @description Shared case presentation retains authoring and Odyssey safety. @module editor */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OdysseyProgress, ProblemVersion, Signature, Submission } from "@quorem/contracts";
import fixture from "../../../../../../fixtures/problems/run-widths.json";
import { caseSnapshotValue, createCustomDraft } from "../customCases";
import { TestCases } from "./TestCases";
import { WorkspaceTests } from "./WorkspaceTests";

const problem = fixture.problem as ProblemVersion;
const methods: Signature[] = [
  {
    className: "Solution",
    methodName: "deposit",
    parameters: [{ name: "amount", type: "int" }],
    returnType: "int",
  },
];
const progress: OdysseyProgress = {
  level: 2,
  completed: false,
  levels: [
    {
      title: "Deposits",
      statementMarkdown: "Deposit funds.",
      methods,
      examples: [{ args: [], calls: [{ methodName: "deposit", args: [5], expected: 5 }] }],
    },
    {
      title: "More deposits",
      statementMarkdown: "Retain earlier behavior.",
      methods: [],
      examples: [{ args: [], calls: [{ methodName: "deposit", args: [9], expected: 9 }] }],
    },
  ],
};

describe("shared test browser", () => {
  it("shows every unlocked suite using named stateful calls", () => {
    const html = renderToStaticMarkup(
      <WorkspaceTests
        problem={{ ...problem, odyssey: { levels: progress.levels.slice(0, 1) } }}
        progress={progress}
        busy={false}
      />,
    );
    expect(html).toContain('aria-label="Case 2"');
    expect(html).toContain("deposit");
    expect(html).toContain("Step 1");
    expect(html).toContain("Step 2");
    expect(html).toContain("amount");
    expect(html).not.toContain('"methodName"');
    expect(html).not.toContain("Custom cases");
  });
  it("keeps required expectations editable without an action that can remove them", () => {
    const draft = { ...createCustomDraft(problem), expectedEnabled: true };
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode
        drafts={[draft]}
        onDraftsChange={() => {}}
        requiredExpected
        minimumCases={0}
      />,
    );
    expect(html).toContain("Expected output");
    expect(html).not.toContain('aria-label="Remove expected output"');
    expect(html).toContain('aria-label="Remove custom case 1"');
  });
  it("allows an empty optional private suite to be populated through the same case rail", () => {
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode
        drafts={[]}
        onDraftsChange={() => {}}
        minimumCases={0}
        requiredExpected
      />,
    );
    expect(html).toContain("Add case");
    expect(html).toContain("Add a case to get started.");
  });
  it("associates a later level's stateful Run output with its admitted call sequence", () => {
    const examples = progress.levels.flatMap((level) => level.examples);
    const p = { ...problem, odyssey: { levels: progress.levels }, examples };
    const snapshot = {
      problemVersionId: p.id,
      custom: false,
      cases: examples.map((value, index) => ({
        id: String(index),
        value: caseSnapshotValue(value),
      })),
    };
    const submission: Submission = {
      id: "sequence-run",
      workspaceId: "workspace",
      kind: "run",
      state: "completed",
      sourceHash: "source",
      admittedAt: "2026-10-24T00:00:00Z",
      updatedAt: "2026-10-24T00:00:01Z",
      verdict: "accepted",
      publicCases: [
        { index: 0, status: "accepted", actual: [5], expected: [5] },
        { index: 1, status: "accepted", actual: [9], expected: [9] },
      ],
    };
    const html = renderToStaticMarkup(
      <TestCases
        problem={p}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        selectedSampleIndex={1}
        snapshot={snapshot}
        submission={submission}
      />,
    );
    expect(html).toContain('aria-label="Case 2: accepted"');
    expect(html).toContain('class="case-run-output"');
    expect(html).toContain('aria-label="Call 1: deposit"');
    expect(html).toContain(">amount</span>");
    expect(html).toContain(">Expected</span>");
    expect(html).not.toContain("[9]");
  });
  it("never submits a surrounding authoring form when choosing, adding or removing cases", () => {
    const draft = { ...createCustomDraft(problem), expectedEnabled: true };
    const html = renderToStaticMarkup(
      <form>
        <TestCases
          problem={problem}
          customMode
          drafts={[draft]}
          onDraftsChange={() => {}}
          minimumCases={0}
          requiredExpected
        />
      </form>,
    );
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(buttons.every((button) => button.includes('type="button"'))).toBe(true);
  });
});

describe("authorized case details", () => {
  const result = {
    index: 0,
    status: "accepted" as const,
    actual: "private-actual",
    expected: "private-expected",
  };
  const submission: Submission = {
    id: "private",
    workspaceId: "workspace",
    kind: "submit",
    state: "completed",
    sourceHash: "source",
    admittedAt: "",
    updatedAt: "",
    hiddenCases: [{ index: 0, status: "accepted" }],
  };
  it("shows full authorized Submit detail through the shared case browser", () => {
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        submission={submission}
        caseResults={[result]}
      />,
    );
    expect(html).toContain("private-actual");
    expect(html).not.toContain('class="locked-case"');
  });
  it("clears prior actual output as a new admission starts", () => {
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        submission={submission}
        caseResults={[result]}
        busy
      />,
    );
    expect(html).not.toContain("private-actual");
  });
});
