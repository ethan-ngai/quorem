/** @file ResultContent.test.tsx @description Admission and hidden-suite presentation boundaries. @module editor */
import { renderToStaticMarkup } from "react-dom/server";
import type { Submission } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import { ResultContent } from "./ResultContent";

const result: Submission = {
  id: "result",
  workspaceId: "workspace",
  kind: "submit",
  state: "completed",
  sourceHash: "original-source",
  admittedAt: "2026-10-10T12:00:00Z",
  updatedAt: "2026-10-10T12:00:01Z",
  verdict: "accepted",
  score: { passed: 2, total: 2 },
  publicCases: [
    { index: 0, status: "accepted", actual: "sample-output", expected: "sample-expected" },
  ],
};

describe("result presentation boundaries", () => {
  it.each(["run", "submit"] as const)(
    "uses a shared notice for a failed %s without exposing infrastructure details",
    (kind) => {
      const markup = renderToStaticMarkup(
        <ResultContent
          submission={{
            ...result,
            kind,
            state: "failed",
            infrastructureError: "private infrastructure detail",
          }}
          busy={false}
        />,
      );
      expect(markup).toContain('class="persistent-notice"');
      expect(markup).toContain(`aria-label="${kind === "run" ? "Run" : "Submit"} failed"`);
      expect(markup).toContain("This execution could not be judged.");
      expect(markup).not.toContain("Judge unavailable");
      expect(markup).not.toContain("private infrastructure detail");
      expect(markup).not.toContain("cases passed");
    },
  );
  it("reserves the shared notice slot after recovery and hides stale failures during admission", () => {
    const healthy = renderToStaticMarkup(<ResultContent submission={result} busy={false} />);
    const pending = renderToStaticMarkup(
      <ResultContent submission={{ ...result, state: "failed" }} busy />,
    );
    expect(healthy).toContain('class="persistent-notice"');
    expect(healthy).not.toContain('aria-label="Submit failed"');
    expect(pending).toContain("Starting");
    expect(pending).not.toContain("could not be judged");
  });
  it("does not insert a transient error banner or show an old verdict after admission fails", () => {
    const markup = renderToStaticMarkup(
      <ResultContent submission={result} busy={false} error="Request failed" />,
    );
    expect(markup).toBe("");
  });
  it("shows a run summary only in its admitted collection", () => {
    const run: Submission = {
      ...result,
      kind: "run",
      score: undefined,
      publicCases: [{ index: 0, status: "wrong_answer" }],
    };
    for (const runWasCustom of [false, true]) {
      for (const customMode of [false, true]) {
        const markup = renderToStaticMarkup(
          <ResultContent
            submission={run}
            busy={false}
            customMode={customMode}
            runWasCustom={runWasCustom}
          />,
        );
        expect(markup.includes("0/1 cases passed")).toBe(customMode === runWasCustom);
      }
    }
    expect(
      renderToStaticMarkup(<ResultContent submission={result} busy={false} customMode />),
    ).toBe("");
  });
  it("renders authorized public sample values for a full-suite submission", () => {
    const markup = renderToStaticMarkup(<ResultContent submission={result} busy={false} />);
    expect(markup).toContain("2/2 cases passed");
    expect(markup).toContain("2/2");
    expect(markup).toContain("sample-output");
    expect(markup).toContain("sample-expected");
  });
  it("suppresses an earlier accepted result while a fresh admission is pending", () => {
    const markup = renderToStaticMarkup(<ResultContent submission={result} busy />);
    expect(markup).toContain("Starting");
    expect(markup).not.toContain("accepted");
  });
  it("summarizes compared runs while leaving uncompared cases out of the count", () => {
    const markup = renderToStaticMarkup(
      <ResultContent
        submission={{
          ...result,
          kind: "run",
          score: undefined,
          verdict: "wrong_answer",
          publicCases: [
            { index: 0, status: "accepted" },
            { index: 1, status: "wrong_answer" },
            { index: 2, status: "executed" },
          ],
        }}
        busy={false}
        showCases={false}
      />,
    );
    expect(markup).toContain("1/2 cases passed");
    expect(markup).not.toContain("case-browser");
  });
  it("shows authoritative Run outputs without inventing input arguments", () => {
    const markup = renderToStaticMarkup(
      <ResultContent submission={{ ...result, kind: "run" }} busy={false} />,
    );
    expect(markup).toContain("sample-output");
    expect(markup).toContain("sample-expected");
    expect(markup).toContain('aria-label="Case 1: accepted"');
    expect(markup).not.toContain("Input:");
  });
});
