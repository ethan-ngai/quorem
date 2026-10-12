import { renderToStaticMarkup } from "react-dom/server";
import type { ProblemVersion } from "@quorem/contracts";
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
