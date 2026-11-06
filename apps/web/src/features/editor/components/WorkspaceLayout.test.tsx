import { workspaceLayout } from "@quorem/ui/tokens";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "./WorkspaceLayout";

function renderLayout() {
  return renderToStaticMarkup(
    <WorkspaceLayout
      navigation={null}
      problem={null}
      editor={null}
      results={null}
      actions={null}
      panel="code"
      onPanelChange={() => {}}
    />,
  );
}

afterEach(() => vi.unstubAllGlobals());

it("uses shared pane defaults when no preferences exist", () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const html = renderLayout();
  expect(html).toContain(`--problem-ratio:${workspaceLayout.problemPane}%`);
  expect(html).toContain(`--results-height:${workspaceLayout.resultsHeight}px`);
});

it("retains saved pane sizes", () => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key.includes("pane-ratio") ? "55" : "300"),
  });
  const html = renderLayout();
  expect(html).toContain("--problem-ratio:55%");
  expect(html).toContain("--results-height:300px");
});
