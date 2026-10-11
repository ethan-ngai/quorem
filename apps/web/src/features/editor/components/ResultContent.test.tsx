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
    { index: 0, status: "accepted", actual: "private-output", expected: "private-expected" },
  ],
};

describe("result presentation boundaries", () => {
  it("never renders case values for a full-suite submission", () => {
    const markup = renderToStaticMarkup(<ResultContent submission={result} busy={false} />);
    expect(markup).toContain("accepted");
    expect(markup).toContain("2/2");
    expect(markup).not.toContain("private-output");
    expect(markup).not.toContain("private-expected");
  });
  it("suppresses an earlier accepted result while a fresh admission is pending", () => {
    const markup = renderToStaticMarkup(<ResultContent submission={result} busy />);
    expect(markup).toContain("Starting");
    expect(markup).not.toContain("accepted");
  });
  it("shows authoritative Run outputs without inventing input arguments", () => {
    const markup = renderToStaticMarkup(
      <ResultContent submission={{ ...result, kind: "run" }} busy={false} />,
    );
    expect(markup).toContain("private-output");
    expect(markup).toContain("private-expected");
    expect(markup).toContain('aria-label="Case 1: accepted"');
    expect(markup).not.toContain("Input:");
  });
});
