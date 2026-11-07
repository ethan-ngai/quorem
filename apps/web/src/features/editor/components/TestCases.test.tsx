import { publicQuestionFixture } from "../../../test/questionFixture";
import { stripSyntaxMarkup } from "../../../test/stripSyntaxMarkup";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import fixture from "../../../../../../fixtures/problems/run-widths.json";
import { createCustomDraft, createRunSnapshot, parseProblemDraft } from "../customCases";
import { TestCases } from "./TestCases";
const problem = {
  ...publicQuestionFixture(fixture),
} as ProblemVersion;
describe("sample case selection", () => {
  it("renders a controlled sample in the shared case detail pane", () => {
    const html = renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        selectedSampleIndex={1}
      />,
    );
    expect(html).toContain('aria-pressed="true" aria-label="Case 2"');
    expect(stripSyntaxMarkup(html)).toContain("[1,2,3]");
    expect(stripSyntaxMarkup(html)).toContain("[1,1,1]");
    expect(stripSyntaxMarkup(html)).not.toContain("[1,1,2,2,2,1]");
  });
  it("preserves first-sample selection without a controlled index", () => {
    const html = renderToStaticMarkup(
      <TestCases problem={problem} customMode={false} drafts={[]} onDraftsChange={() => {}} />,
    );
    expect(html).toContain('aria-pressed="true" aria-label="Case 1"');
    expect(stripSyntaxMarkup(html)).toContain("[1,1,2,2,2,1]");
  });
});

const submission: Submission = {
  id: "submission",
  workspaceId: "workspace",
  kind: "run",
  state: "running",
  sourceHash: "source",
  admittedAt: "2026-10-12T12:00:00Z",
  updatedAt: "2026-10-12T12:00:01Z",
};

function renderCases(
  result?: Submission,
  busy = false,
  customMode = false,
  pendingKind?: Submission["kind"],
) {
  return renderToStaticMarkup(
    <TestCases
      problem={problem}
      customMode={customMode}
      drafts={[]}
      onDraftsChange={() => {}}
      submission={result}
      busy={busy}
      pendingKind={pendingKind}
      hiddenCaseCount={3}
    />,
  );
}

describe("pending case execution", () => {
  it("shows indeterminate case loading before the judge returns public cases", () => {
    const html = renderCases(submission);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Case 1: pending"');
    expect(html).toContain('class="case-spinner" aria-hidden="true"');
    expect(html).toContain("Judging test case");
    expect(html).not.toContain("case-loading");
    expect(html).not.toContain('aria-label="Case 1: accepted"');
  });

  it("shows a queued state and an initial admission state", () => {
    expect(renderCases({ ...submission, state: "queued" })).toContain("Judging test case");
    expect(renderCases(undefined, true)).toContain("Judging test case");
  });

  it("suppresses an earlier result while a fresh admission is pending", () => {
    const html = renderCases(
      {
        ...submission,
        state: "completed",
        publicCases: [{ index: 0, status: "accepted", actual: "stale-output" }],
      },
      true,
    );
    expect(html).toContain("Judging test case");
    expect(html).not.toContain("stale-output");
    expect(html).not.toContain('aria-label="Case 1: accepted"');
  });

  it("keeps pending sample results out of the custom collection", () => {
    expect(renderCases(submission, false, true)).not.toContain("case-spinner");
  });

  it("shows all public and hidden spinners immediately when submitting", () => {
    const html = renderCases(undefined, true, false, "submit");
    expect(html).toContain("Judging test case");
    expect(html).toContain('aria-label="Case 1: pending"');
    expect(html.match(/aria-label="Hidden case \d: pending"/g)).toHaveLength(3);
  });

  it("replaces the selected spinner as soon as its verdict arrives", () => {
    const html = renderCases({
      ...submission,
      kind: "submit",
      publicCases: [{ index: 0, status: "runtime_error" }],
      hiddenCases: [{ index: 1, status: "accepted" }],
    });
    expect(html).toContain("Runtime error");
    expect(html).not.toContain("Judging test case");
    expect(html).toContain('aria-label="Hidden case 1: pending"');
    expect(html).toContain('aria-label="Hidden case 2: passed"');
    expect(html).toContain('aria-label="Case 2: pending"');
  });

  it("removes loading indicators after execution finishes", () => {
    const html = renderCases({
      ...submission,
      state: "completed",
      publicCases: [{ index: 0, status: "accepted", actual: "[2,3,1]" }],
    });
    expect(html).not.toContain("case-spinner");
    expect(html).toContain('aria-label="Case 1: accepted"');
    expect(stripSyntaxMarkup(html)).toContain("[2,3,1]");
  });
});

describe("Submit sample results and previous steps", () => {
  const completed: Submission = {
    ...submission,
    kind: "submit",
    state: "completed",
    publicCases: [
      { index: 0, status: "accepted", actual: [1, 2], expected: [1, 2] },
      { index: 1, status: "wrong_answer", actual: [7], expected: [1] },
    ],
    hiddenCases: [{ index: 0, status: "wrong_answer" }],
  };
  it("shows public Submit outputs without exposing the hidden case collection", () => {
    const html = renderCases(completed);
    expect(html).toContain('aria-label="Case 1: accepted"');
    expect(stripSyntaxMarkup(html)).toContain("[1,2]");
    expect(html).not.toContain('aria-label="Select hidden case"');
  });
  function staged(results: Submission) {
    return renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode={false}
        drafts={[]}
        onDraftsChange={() => {}}
        submission={results}
        caseGroups={["Step 1", "Step 2"]}
        currentCaseGroup="Step 2"
      />,
    );
  }
  it("collapses passing previous steps and selects the current step", () => {
    const html = staged(completed);
    expect(html).toContain('<details class="case-group disclosure">');
    expect(html).toContain("Step 1");
    expect(html).toContain(": passed");
    expect(html).toContain('aria-pressed="true" aria-label="Case 2: wrong answer"');
  });
  it("opens a failing previous step", () => {
    const html = staged({
      ...completed,
      publicCases: [
        { index: 0, status: "wrong_answer", actual: [7] },
        { index: 1, status: "accepted", actual: [1] },
      ],
    });
    expect(html).toContain('<details class="case-group disclosure" open="">');
    expect(html).toContain(": failing");
  });
});

describe("compiler diagnostic ownership", () => {
  const first = { ...createCustomDraft(problem), id: "first" };
  const second = { ...first, id: "second" };
  const snapshot = createRunSnapshot(problem.id, [parseProblemDraft(first, problem)], [first]);
  const failed: Submission = {
    ...submission,
    state: "completed",
    customRun: true,
    verdict: "syntax_error",
    diagnostics: [{ line: 6, message: "expected colon" }],
  };
  function render(
    selectedCustomId: string,
    overrides: Partial<Parameters<typeof TestCases>[0]> = {},
  ) {
    return renderToStaticMarkup(
      <TestCases
        problem={problem}
        customMode
        drafts={[first, second]}
        onDraftsChange={() => {}}
        selectedCustomId={selectedCustomId}
        submission={failed}
        snapshot={snapshot}
        {...overrides}
      />,
    );
  }
  it("shows diagnostics only for the admitted custom case, even when another case has identical inputs", () => {
    expect(render("first")).toContain("expected colon");
    expect(render("second")).not.toContain("expected colon");
  });
  it("clears compiler feedback after the admitted inputs change", () => {
    expect(render("first", { drafts: [{ ...first, args: ["[9,9,9]"] }] })).not.toContain(
      "expected colon",
    );
  });
  it("does not attach sample or Submit compilation errors to custom cases", () => {
    expect(render("first", { snapshot: { ...snapshot, custom: false } })).not.toContain(
      "expected colon",
    );
    expect(
      render("first", {
        submission: { ...failed, kind: "submit", customRun: false },
        snapshot: undefined,
      }),
    ).not.toContain("expected colon");
  });
  it("does not infer ownership from custom case positions without a matching snapshot", () => {
    expect(render("first", { snapshot: undefined })).not.toContain("expected colon");
    expect(render("first", { snapshot: { ...snapshot, problemVersionId: "other" } })).not.toContain(
      "expected colon",
    );
  });
  it("does not attach a custom run compiler error to examples", () => {
    expect(render("first", { customMode: false })).not.toContain("expected colon");
  });
});

describe("execution result ownership", () => {
  const statuses = [
    "syntax_error",
    "runtime_error",
    "wrong_answer",
    "time_limit",
    "memory_limit",
    "output_limit",
    "invalid_output",
  ] as const satisfies readonly PublicCaseResult["status"][];
  const first = { ...createCustomDraft(problem), id: "ran" };
  const second = { ...first, id: "unrun" };
  const snapshot = createRunSnapshot(problem.id, [parseProblemDraft(first, problem)], [first]);
  it.each(statuses)(
    "keeps %s, its output and diagnostics attached to the admitted case",
    (status) => {
      const failed: Submission = {
        ...submission,
        state: "completed",
        customRun: true,
        verdict: status,
        diagnostics: [{ message: "submission-detail" }],
        publicCases: [
          {
            index: 0,
            status,
            actual: "old-value",
            stdout: "old-stdout",
            stderr: "old-stderr",
            diagnostics: [{ message: "case-owned-diagnostic" }],
          },
        ],
      };
      function render(
        selectedCustomId: string,
        overrides: Partial<Parameters<typeof TestCases>[0]> = {},
      ) {
        return renderToStaticMarkup(
          <TestCases
            problem={problem}
            customMode
            drafts={[first, second]}
            onDraftsChange={() => {}}
            snapshot={snapshot}
            submission={failed}
            selectedCustomId={selectedCustomId}
            {...overrides}
          />,
        );
      }
      expect(render("ran")).toContain("case-owned-diagnostic");
      for (const html of [
        render("unrun"),
        render("ran", { drafts: [{ ...first, args: ["[9,9,9]"] }] }),
        render("ran", { drafts: [{ ...first, args: ["["] }] }),
        render("ran", { snapshot: undefined }),
        render("ran", { snapshot: { ...snapshot, problemVersionId: "other" } }),
        render("ran", { customMode: false }),
      ]) {
        for (const text of [
          "case-owned-diagnostic",
          "submission-detail",
          "old-value",
          "old-stdout",
          "old-stderr",
          "case-verdict-group",
          "case-run-output",
        ])
          expect(html).not.toContain(text);
      }
    },
  );
});
