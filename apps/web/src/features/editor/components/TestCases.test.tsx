import { renderToStaticMarkup } from "react-dom/server";
import type { ProblemVersion, Submission } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import fixture from "../../../../../../fixtures/problems/run-widths.json";
import { TestCases } from "./TestCases";
const problem = fixture.problem as ProblemVersion;
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
