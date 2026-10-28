/** @file WorkspaceTests.test.tsx @description Shared case presentation retains authoring and Odyssey safety. @module editor */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OdysseyProgress, ProblemVersion, Signature, Submission } from "@quorem/contracts";
import fixture from "../../../../../../fixtures/problems/run-widths.json";
import { caseSnapshotValue, createCustomDraft } from "../customCases";
import { TestCases } from "./TestCases";
import { WorkspaceTests } from "./WorkspaceTests";

const problem = {
  ...fixture.problem,
  starterSource: fixture.implementations[0]!.starterSource,
  runtimeRevision: fixture.implementations[0]!.runtimeRevision,
} as ProblemVersion;
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

describe("advancing beyond the last executed Odyssey step", () => {
  const previous: Submission = {
    id: "previous-step",
    workspaceId: "workspace",
    kind: "submit",
    state: "completed",
    sourceHash: "source",
    admittedAt: "2026-10-25T12:00:00Z",
    updatedAt: "2026-10-25T12:00:01Z",
    hiddenCases: Array.from({ length: 4 }, (_, index) => ({ index, status: "accepted" as const })),
  };
  function advanced(result: Submission) {
    return renderToStaticMarkup(
      <WorkspaceTests
        problem={{ ...problem, odyssey: { levels: progress.levels.slice(0, 1) } }}
        progress={progress}
        submission={result}
        busy={false}
        snapshot={{ problemVersionId: problem.id, custom: false, cases: [] }}
      />,
    );
  }
  it("never maps legacy hidden verdicts onto newly unlocked public examples", () => {
    const html = advanced(previous);
    expect(html).toContain('aria-pressed="true" aria-label="Case 2"');
    expect(html).not.toContain('aria-label="Case 2: accepted"');
    expect(html).not.toContain('class="locked-case"');
    expect(html).toContain('aria-label="Select test case"');
    expect(html).toContain("Expected output");
    expect(html).toContain(">9<");
  });
  it.each(["run", "submit"] as const)(
    "retains %s results only for the executed prefix and displays the new step unrun",
    (kind) => {
      const html = advanced({
        ...previous,
        kind,
        publicCases: [{ index: 0, status: "accepted", actual: [5], expected: [5] }],
      });
      expect(html).toContain('aria-label="Case 1: accepted"');
      expect(html).toContain('aria-pressed="true" aria-label="Case 2"');
      expect(html).not.toContain('aria-label="Case 2: accepted"');
      expect(html).toContain("Expected output");
      expect(html).toContain(">9<");
      expect(html).not.toContain('class="locked-case"');
    },
  );
});

describe("compiler failures", () => {
  it("shows submission diagnostics in the case pane when compilation has no case output", () => {
    const html = renderToStaticMarkup(
      <WorkspaceTests
        problem={problem}
        busy={false}
        submission={{
          id: "syntax",
          workspaceId: "workspace",
          kind: "run",
          state: "completed",
          sourceHash: "source",
          admittedAt: "",
          updatedAt: "",
          verdict: "syntax_error",
          diagnostics: [{ line: 4, message: "SyntaxError: expected ':'" }],
        }}
      />,
    );
    expect(html).toContain('class="case-error-message"');
    expect(html).toContain("Line 4:");
  });
});

describe("retained evaluated step statuses", () => {
  it.each([undefined, "queued", "running"] as const)(
    "retains section and individual checks with latest submission %s",
    (state) => {
      const html = renderToStaticMarkup(
        <WorkspaceTests
          problem={problem}
          progress={{ ...progress, caseStatuses: [{ index: 0, status: "accepted" }] }}
          busy={!!state}
          submission={
            state
              ? {
                  id: "pending",
                  workspaceId: "w",
                  kind: "submit",
                  state,
                  sourceHash: "s",
                  admittedAt: "",
                  updatedAt: "",
                }
              : undefined
          }
        />,
      );
      expect(html).toContain('aria-label="Case 1: accepted"');
      expect(html).toContain("Step 1");
      expect(html).toContain(": passed");
      expect(html).not.toContain('aria-label="Case 2: accepted"');
      expect(html).not.toContain('class="locked-case"');
    },
  );
  it("never substitutes hidden cases in a grouped browser even without Odyssey metadata", () => {
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        drafts={[]}
        onDraftsChange={() => {}}
        customMode={false}
        caseGroups={["Step 1", "Step 2"]}
        currentCaseGroup="Step 2"
        submission={{
          id: "legacy",
          workspaceId: "w",
          kind: "submit",
          state: "completed",
          sourceHash: "s",
          admittedAt: "",
          updatedAt: "",
          hiddenCases: [
            { index: 0, status: "accepted" },
            { index: 1, status: "accepted" },
          ],
        }}
      />,
    );
    expect(html).not.toContain('class="locked-case"');
    expect(html).toContain('aria-label="Select test case"');
    expect(html).toContain('aria-pressed="true" aria-label="Case 2"');
  });
});

it("keeps earlier case labels accepted during a pending Run", () => {
  const html = renderToStaticMarkup(
    <WorkspaceTests
      problem={problem}
      progress={{ ...progress, caseStatuses: [{ index: 0, status: "accepted" }] }}
      busy
      submission={{
        id: "running",
        workspaceId: "w",
        kind: "run",
        state: "running",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
      }}
    />,
  );
  expect(html).toContain('aria-label="Case 1: accepted"');
  expect(html).toContain('aria-label="Case 2: pending"');
});

it("omits the score summary above Odyssey examples", () => {
  const html = renderToStaticMarkup(
    <WorkspaceTests
      problem={problem}
      progress={{ ...progress, caseStatuses: [{ index: 0, status: "accepted" }] }}
      busy={false}
      submission={{
        id: "stage1",
        workspaceId: "w",
        kind: "submit",
        state: "completed",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
        verdict: "accepted",
        score: { passed: 2, total: 2 },
        publicCases: [{ index: 0, status: "accepted" }],
      }}
    />,
  );
  expect(html).not.toContain("examples passed");
  expect(html).not.toContain("2/2 cases passed");
  expect(html).not.toContain('class="run-overview"');
});

it("groups hidden tests in the case rail without putting their score above Odyssey examples", () => {
  const html = renderToStaticMarkup(
    <WorkspaceTests
      problem={problem}
      progress={progress}
      busy={false}
      submission={{
        id: "hidden",
        workspaceId: "workspace",
        kind: "submit",
        state: "completed",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
        verdict: "accepted",
        score: { passed: 2, total: 2 },
        hiddenCases: [
          { index: 0, status: "accepted" },
          { index: 1, status: "accepted" },
        ],
        publicCases: [{ index: 0, status: "accepted" }],
      }}
    />,
  );
  expect(html).toContain('class="case-group-label case-group-label--locked"');
  expect(html).not.toContain('id="tests-hidden-tab"');
  expect(html).not.toContain("2/2 cases passed");
  expect(html).toContain('aria-label="Hidden case 1: passed"');
  expect(html).toContain('aria-label="Case 1: accepted"');
  expect(html).not.toContain('aria-label="Case 2: accepted"');
});

it("keeps public results separate from hidden case statuses", () => {
  const html = renderToStaticMarkup(
    <TestCases
      problem={{ ...problem, odyssey: { levels: progress.levels } }}
      customMode={false}
      drafts={[]}
      onDraftsChange={() => {}}
      submission={{
        id: "hidden",
        workspaceId: "w",
        kind: "submit",
        state: "completed",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
        publicCases: [{ index: 0, status: "accepted", actual: "public-output" }],
        hiddenCases: [
          { index: 0, status: "accepted" },
          { index: 1, status: "time_limit" },
        ],
      }}
    />,
  );
  expect(html).toContain('aria-label="Hidden case 1: passed"');
  expect(html).toContain('aria-label="Hidden case 2: time limit exceeded"');
  expect(html).toContain("public-output");
  expect(html).not.toContain('class="locked-case"');
});

it("renders SQL table examples without binding method arguments", () => {
  const sqlProblem: ProblemVersion = {
    ...problem,
    signature: { className: "Solution", methodName: "solve", parameters: [], returnType: "int" },
    sql: { dialect: "postgresql" as const, outputOrder: "unordered" as const },
    examples: [
      {
        args: [{ tables: [{ name: "items", columns: [], rows: [] }] }],
        expected: { columns: ["id"], rows: [] },
      },
    ],
  };
  const html = renderToStaticMarkup(<WorkspaceTests problem={sqlProblem} busy={false} />);
  expect(html).toContain("Tables");
  expect(html).toContain("items");
  expect(html).not.toContain("Custom cases");
});

it.each(["coding", "sql"] as const)(
  "offers hidden cases after a %s submission with public samples",
  (kind) => {
    const tested =
      kind === "sql"
        ? { ...problem, sql: { dialect: "postgresql" as const, outputOrder: "unordered" as const } }
        : problem;
    const html = renderToStaticMarkup(
      <WorkspaceTests
        problem={tested}
        busy={false}
        onDraftsChange={() => {}}
        submission={{
          id: "submit",
          workspaceId: "workspace",
          kind: "submit",
          state: "completed",
          sourceHash: "s",
          admittedAt: "",
          updatedAt: "",
          hiddenCases: [
            { index: 0, status: "accepted" },
            { index: 1, status: "wrong_answer" },
          ],
          publicCases: [{ index: 0, status: "accepted", actual: "public-result" }],
        }}
      />,
    );
    expect(html).not.toContain('id="tests-hidden-tab"');
    expect(html).toContain('class="case-group-label case-group-label--locked"');
    expect(html).toContain('aria-label="Hidden case 1: passed"');
    expect(html).toContain('aria-label="Hidden case 2: failed"');
    expect(html).toContain("public-result");
    expect(html).toContain('aria-label="Select test case"');
    expect(html).toContain('id="tests-custom-tab"');
  },
);

it("does not offer stale hidden cases while a new submission starts", () => {
  const html = renderToStaticMarkup(
    <WorkspaceTests
      problem={problem}
      busy
      submission={{
        id: "old",
        workspaceId: "workspace",
        kind: "submit",
        state: "completed",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
        hiddenCases: [{ index: 0, status: "accepted" }],
      }}
    />,
  );
  expect(html).not.toContain('class="case-group-label case-group-label--locked"');
});

it("shows a shared custom run separately from local drafts", () => {
  const html = renderToStaticMarkup(
    <WorkspaceTests
      problem={problem}
      busy={false}
      customMode
      onCustomModeChange={() => {}}
      drafts={[createCustomDraft(problem)]}
      onDraftsChange={() => {}}
      submission={{
        id: "shared",
        workspaceId: "w",
        kind: "run",
        customRun: true,
        state: "completed",
        sourceHash: "s",
        admittedAt: "",
        updatedAt: "",
        publicCases: [{ index: 0, status: "executed", actual: 42 }],
      }}
    />,
  );
  expect(html).toContain("inputs may differ from your drafts");
  expect(html).toContain('aria-label="Select run result"');
  expect(html).toContain("42");
});
