// @vitest-environment happy-dom
/** @file WorkspaceCompletion.test.tsx @description Completion policy across restored results and Odyssey stages. @module completion */
import { act, StrictMode, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { OdysseyProgress, Submission } from "@quorem/contracts";
import { SubmissionCelebration } from "./SubmissionCelebration";
import { WorkspaceCompletion } from "./WorkspaceCompletion";

vi.mock("./CompletionDialog", () => ({
  CompletionDialog: ({
    open,
    title,
    actions,
  }: {
    open: boolean;
    title: string;
    actions: ReactNode;
  }) =>
    open ? (
      <section role="dialog">
        {title}
        {actions}
      </section>
    ) : null,
}));
vi.mock("../../ui/Celebration", async () => {
  const { canCelebrate } = await import("../../ui/completionOutcome");
  return {
    Celebration: ({
      outcome,
    }: {
      outcome: import("../../ui/completionOutcome").CompletionOutcome;
    }) => (canCelebrate(outcome) ? <span data-confetti /> : null),
  };
});
const accepted: Submission = {
  id: "s1",
  workspaceId: "w1",
  kind: "submit",
  state: "completed",
  sourceHash: "hash",
  admittedAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:01Z",
  verdict: "accepted",
  score: { passed: 24, total: 24 },
};
const progress: OdysseyProgress = { level: 2, completed: false, levels: [], totalLevels: 4 };
let root: Root;
let container: HTMLDivElement;
async function render(props: Partial<ComponentProps<typeof WorkspaceCompletion>> = {}) {
  await act(async () =>
    root.render(
      <StrictMode>
        <WorkspaceCompletion
          workspaceId="w1"
          title="Two Sum"
          language="python"
          difficulty="easy"
          outcome="success"
          submission={accepted}
          {...props}
        />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("celebrates every distinct accepted Submit, including after dismissing the previous one", async () => {
  await render();
  expect(container.textContent).toContain("Problem solved");
  await act(async () => container.querySelector("button")!.click());
  await render({ submission: { ...accepted } });
  expect(container.querySelector("[role=dialog]")).toBeNull();
  await render({ submission: { ...accepted, id: "s2" } });
  expect(container.textContent).toContain("Problem solved");
});
it.each([
  { kind: "run" },
  { state: "running" },
  { verdict: "wrong_answer" },
  { workspaceId: "other" },
] as Partial<Submission>[])("ignores non-completion evidence %j", async (changes) => {
  await render({ submission: { ...accepted, ...changes } });
  expect(container.innerHTML).toBe("");
});
it("does not replay restored completed results after remount", async () => {
  await render();
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.innerHTML).toBe("");
});
it("waits for refreshed Odyssey progress, celebrates intermediate levels without a modal", async () => {
  await render({ odyssey: progress, odysseyReady: false });
  expect(container.innerHTML).toBe("");
  await render({ odyssey: progress });
  expect(container.querySelector("[data-confetti]")).not.toBeNull();
  expect(container.querySelector("[role=dialog]")).toBeNull();
  await render({
    submission: { ...accepted, id: "final" },
    odyssey: { ...progress, completed: true },
  });
  expect(container.textContent).toContain("Odyssey complete");
});
it("leaves competitive celebration to the settled result, including Odyssey", async () => {
  await render({ competitive: true, outcome: "pending" });
  expect(container.innerHTML).toBe("");
  await render({ competitive: true, odyssey: progress, outcome: "pending" });
  expect(container.innerHTML).toBe("");
  await render({ competitive: true, odyssey: progress, outcome: "loss" });
  expect(container.innerHTML).toBe("");
});
it("celebrates an observed accepted result without requiring ownership or case disclosure", async () => {
  const shared = {
    ...accepted,
    workspaceId: undefined,
    publicCases: undefined,
    hiddenCases: undefined,
  };
  await act(async () =>
    root.render(
      <SubmissionCelebration
        scope="interview:one:question"
        submission={shared}
        outcome="observer"
      />,
    ),
  );
  expect(container.querySelector("[data-confetti]")).not.toBeNull();
  expect(container.querySelector("[role=dialog]")).toBeNull();
});
it("does not celebrate failed shared interview submissions", async () => {
  await act(async () =>
    root.render(
      <SubmissionCelebration
        scope="interview:one:question"
        submission={{ ...accepted, verdict: "wrong_answer" }}
        outcome="observer"
      />,
    ),
  );
  expect(container.innerHTML).toBe("");
});
