import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ProblemVersion } from "@quorem/contracts";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { id: "copy", language: "python", kind: "review" } }),
}));
vi.mock("../editor/useWorkspaceDraft", () => ({
  useWorkspaceDraft: () => ({
    workspace: { id: "copy" },
    source: "opponent draft",
    sourceRef: { current: "opponent draft" },
    saveBeforeSwitch: vi.fn(),
    updateSource: vi.fn(),
  }),
}));
vi.mock("../editor/PythonEditor", () => ({
  PythonEditor: ({ readOnly }: { readOnly: boolean }) => <div data-readonly={String(readOnly)} />,
}));
import { ReviewComparison } from "./ReviewComparison";

it("marks the comparison copy read-only until explicitly selected", () => {
  const markup = renderToStaticMarkup(
    <ReviewComparison
      identity="alice"
      matchId="match"
      participant={{
        userId: "bob",
        displayName: "Bob",
        own: false,
        workspace: null,
        submission: { source: "original", language: "python", verdict: null, state: "completed" },
      }}
      problem={{ id: "version", languages: [{ language: "python" }] } as ProblemVersion}
      theme="light"
      colorScheme="jetbrains-light"
      fontSize={15}
      tabSize={4}
      wrap={false}
      hidden={false}
      onSource={() => {}}
      onSelect={() => {}}
      disabled={false}
    />,
  );
  expect(markup).toContain('data-readonly="true"');
  expect(markup).toContain("Edit this copy");
});
