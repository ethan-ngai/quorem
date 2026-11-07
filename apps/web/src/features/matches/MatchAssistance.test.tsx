// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { MatchSnapshot, Submission } from "@quorem/contracts";
import { matchPreset } from "@quorem/contracts/match-rules";
import { MatchAssistance } from "./MatchAssistance";
const action = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ matchRuleAction: action }));

it("selects a passed hidden case and binds approval to that case", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  action.mockImplementation(async (_identity, _match, input) => ({
    quote: {
      kind: "hiddenCase",
      caseIndex: input.caseIndex,
      ruleVersion: "v1",
      seconds: 0,
      points: 0,
      cooldownSeconds: 0,
      alreadyRevealed: false,
    },
    ...(input.approval ? { revealed: { input: "case input", result: "accepted" } } : {}),
  }));
  const match = {
    id: "match",
    state: "active",
    problemVersionId: "problem",
    participants: [{ userId: "alice" }],
    rules: matchPreset("casual"),
  } as MatchSnapshot;
  const submission = {
    id: "submission",
    kind: "submit",
    state: "completed",
    score: { passed: 3, total: 3 },
  } as Submission;
  const client = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MatchAssistance match={match} identity="alice" submission={submission} />
      </QueryClientProvider>,
    ),
  );
  const input = container.querySelector<HTMLInputElement>('[aria-label="Hidden case number"]')!;
  expect(input.max).toBe("3");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Reveal case")!
      .click(),
  );
  expect(action).toHaveBeenNthCalledWith(1, "alice", "match", {
    kind: "hiddenCase",
    submissionId: "submission",
    caseIndex: 1,
  });
  expect(action).toHaveBeenNthCalledWith(
    2,
    "alice",
    "match",
    expect.objectContaining({ caseIndex: 1, approval: expect.objectContaining({ seconds: 0 }) }),
  );
  expect(container.textContent).toContain("Hidden case 2");
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
