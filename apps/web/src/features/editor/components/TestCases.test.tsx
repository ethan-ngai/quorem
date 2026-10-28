import { renderToStaticMarkup } from "react-dom/server";
import type { ProblemVersion, Submission } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import fixture from "../../../../../../fixtures/problems/run-widths.json";
import { TestCases } from "./TestCases";
const problem = {
  ...fixture.problem,
  starterSource: fixture.implementations[0]!.starterSource,
  runtimeRevision: fixture.implementations[0]!.runtimeRevision,
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
    expect(html).toContain("[1,2,3]");
    expect(html).toContain("[1,1,1]");
    expect(html).not.toContain("[1,1,2,2,2,1]");
  });
  it("preserves first-sample selection without a controlled index", () => {
    const html = renderToStaticMarkup(
      <TestCases problem={problem} customMode={false} drafts={[]} onDraftsChange={() => {}} />,
    );
    expect(html).toContain('aria-pressed="true" aria-label="Case 1"');
    expect(html).toContain("[1,1,2,2,2,1]");
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

function renderCases(result?: Submission, busy = false, customMode = false) {
  return renderToStaticMarkup(
    <TestCases
      problem={problem}
      customMode={customMode}
      drafts={[]}
      onDraftsChange={() => {}}
      submission={result}
      busy={busy}
    />,
  );
}

describe("pending case execution", () => {
  it("shows indeterminate case loading before the judge returns public cases", () => {
    const html = renderCases(submission);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Case 1: pending"');
    expect(html).toContain('class="case-spinner" aria-hidden="true"');
    expect(html).toContain("Running cases…");
    expect(html).not.toContain('aria-label="Case 1: accepted"');
  });

  it("shows a queued state and an initial admission state", () => {
    expect(renderCases({ ...submission, state: "queued" })).toContain("Waiting for judge…");
    expect(renderCases(undefined, true)).toContain("Starting…");
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
    expect(html).toContain("Starting…");
    expect(html).not.toContain("stale-output");
    expect(html).not.toContain('aria-label="Case 1: accepted"');
  });

  it("keeps pending sample results out of the custom collection", () => {
    expect(renderCases(submission, false, true)).not.toContain("case-spinner");
  });

  it("labels a full-suite run without claiming samples are being judged", () => {
    const html = renderCases({ ...submission, kind: "submit" });
    expect(html).toContain("Judging hidden cases…");
    expect(html).not.toContain('aria-label="Case 1: pending"');
  });

  it("removes loading indicators after execution finishes", () => {
    const html = renderCases({
      ...submission,
      state: "completed",
      publicCases: [{ index: 0, status: "accepted", actual: "[2,3,1]" }],
    });
    expect(html).not.toContain("case-spinner");
    expect(html).toContain('aria-label="Case 1: accepted"');
    expect(html).toContain("[2,3,1]");
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
    expect(html).toContain("[1,2]");
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
    expect(html).toContain('<details class="case-group">');
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
    expect(html).toContain('<details class="case-group" open="">');
    expect(html).toContain(": failing");
  });
});
