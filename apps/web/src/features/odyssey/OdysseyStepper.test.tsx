/** @file OdysseyStepper.test.tsx @description Locked stage metadata and completion navigation. @module odyssey */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OdysseyStepper } from "./OdysseyStepper";
import type { OdysseyProgress } from "@quorem/contracts";
const progress: OdysseyProgress = {
  level: 1,
  completed: false,
  totalLevels: 3,
  levels: [{ title: "Deposits", statementMarkdown: "", methods: [], examples: [] }],
};
describe("Odyssey stage navigation", () => {
  it("shows the total without leaking locked level names", () => {
    const html = renderToStaticMarkup(<OdysseyStepper progress={progress} onSelect={() => {}} />);
    expect(html).toContain("Step 1 of 3");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("All levels complete");
  });
  it("keeps a non-navigable interviewer view on the active stage", () => {
    const html = renderToStaticMarkup(
      <OdysseyStepper
        progress={{
          ...progress,
          level: 2,
          levels: [...progress.levels, { ...progress.levels[0]!, title: "Withdrawals" }],
        }}
        selectedLevel={1}
      />,
    );
    expect(html).toContain("Step 2 of 3");
    expect(html).toContain('aria-label="2. Withdrawals" aria-current="step"');
    expect(html).not.toContain('aria-label="1. Deposits, passed" aria-current="step"');
  });
  it("marks passed stages while letting an earlier stage be reviewed", () => {
    const html = renderToStaticMarkup(
      <OdysseyStepper
        progress={{
          ...progress,
          level: 2,
          levels: [...progress.levels, { ...progress.levels[0]!, title: "Withdrawals" }],
        }}
        selectedLevel={1}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-label="1. Deposits, passed" aria-current="step"');
    expect(html).toContain('data-complete="true"');
    expect(html).toContain("Step 1 of 3");
  });
});

it("does not equate manually unlocked stages with verified passes", () => {
  const html = renderToStaticMarkup(
    <OdysseyStepper
      progress={{
        ...progress,
        level: 2,
        levels: [...progress.levels, { ...progress.levels[0]!, title: "Withdrawals" }],
      }}
      passedLevels={[]}
    />,
  );
  expect(html).not.toContain(", passed");
  expect(html).not.toContain('data-complete="true"');
});

it("composes optional practice actions without stage-button styling", () => {
  const html = renderToStaticMarkup(
    <OdysseyStepper
      progress={progress}
      actions={<button type="button" className="icon-button" aria-label="Reset Odyssey progress" />}
    />,
  );
  expect(html).toContain('class="icon-button" aria-label="Reset Odyssey progress"');
  expect(html.indexOf('aria-label="Reset Odyssey progress"')).toBeGreaterThan(
    html.indexOf("</ol>"),
  );
});
