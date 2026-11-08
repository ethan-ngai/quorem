// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { MatchSnapshot, Submission } from "@quorem/contracts";
import { matchPreset } from "@quorem/contracts/match-rules";
import { WorkspaceTests } from "../editor/components/WorkspaceTests";
import { publicQuestionFixture } from "../../test/questionFixture";
import fixture from "../../../../../fixtures/problems/run-widths.json";
import { MatchAssistance } from "./MatchAssistance";
const action = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: notify } }));
vi.mock("./api", () => ({ matchRuleAction: action }));

it.each([
  { seconds: 0, rejected: false },
  { seconds: 30, rejected: false },
  { seconds: 30, rejected: true },
])(
  "binds a $seconds-second reveal to the chosen case (rejected=$rejected)",
  async ({ seconds, rejected }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const matchMedia = window.matchMedia.bind(window);
    const reducedMotion = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const media = matchMedia(query);
      if (query === "(prefers-reduced-motion: reduce)")
        Object.defineProperty(media, "matches", { value: true });
      return media;
    });
    const insufficient = "The time penalty must be less than your remaining submission time";
    action.mockReset();
    notify.mockClear();
    action.mockImplementation(async (_identity, _match, input) => {
      if (rejected && input.approval) throw new Error(insufficient);
      return {
        quote: {
          kind: "hiddenCase",
          caseIndex: input.caseIndex,
          ruleVersion: "v1",
          seconds,
          points: 0,
          cooldownSeconds: 0,
          alreadyRevealed: false,
        },
        ...(input.approval
          ? {
              revealed: {
                input: JSON.stringify({
                  args: ["private-case-input"],
                  expected: "private-expected",
                }),
                result: JSON.stringify({
                  index: input.caseIndex,
                  status: "accepted",
                  actual: "private-actual",
                }),
              },
            }
          : {}),
      };
    });
    const match = {
      id: "match",
      state: "active",
      problemVersionId: "problem",
      participants: [{ userId: "alice" }],
      rules: matchPreset(seconds ? "balanced" : "casual"),
    } as MatchSnapshot;
    const submission = {
      id: "submission",
      kind: "submit",
      state: "completed",
      score: { passed: 1, total: 2 },
      hiddenCases: [
        { index: 0, status: "wrong_answer" },
        { index: 1, status: "accepted" },
      ],
    } as Submission;
    const client = new QueryClient();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MatchAssistance match={match} identity="alice" submission={submission}>
            {({ hiddenCaseDetails }) => (
              <WorkspaceTests
                problem={publicQuestionFixture(fixture)}
                busy={false}
                submission={submission}
                hiddenCaseDetails={hiddenCaseDetails}
              />
            )}
          </MatchAssistance>
        </QueryClientProvider>,
      ),
    );
    const caseButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Hidden case 2: passed"]',
    )!;
    await act(async () => caseButton.click());
    expect(container.textContent).not.toContain("private-case-input");
    const trigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reveal case",
    )!;
    vi.spyOn(trigger, "getClientRects").mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    await act(async () => {
      trigger.click();
      trigger.click();
    });
    expect(action).toHaveBeenNthCalledWith(1, "alice", "match", {
      kind: "hiddenCase",
      submissionId: "submission",
      caseIndex: 1,
    });
    if (seconds) {
      expect(action).toHaveBeenCalledTimes(1);
      expect(container.textContent).not.toContain("private-case-input");
      const popover = document.querySelector(".assistance-confirmation")!;
      expect(popover.textContent).toContain("+30s");
      expect(popover.textContent).toContain("Deducted from submission time");
      const confirm = [...popover.querySelectorAll("button")].find(
        (button) => button.textContent === "Reveal hidden case 2",
      )!;
      await act(async () => {
        confirm.click();
        confirm.click();
      });
    }
    expect(action).toHaveBeenNthCalledWith(
      2,
      "alice",
      "match",
      expect.objectContaining({ caseIndex: 1, approval: expect.objectContaining({ seconds }) }),
    );
    expect(action).toHaveBeenCalledTimes(2);
    if (rejected) {
      expect(notify).toHaveBeenCalledWith(insufficient, expect.any(Object));
      expect(container.textContent).not.toContain("private-case-input");
    } else {
      expect(container.textContent).toContain("private-case-input");
      expect(container.textContent).toContain("private-expected");
      expect(container.textContent).toContain("private-actual");
      const locked = container.querySelector<HTMLButtonElement>(
        '[aria-label="Hidden case 1: failed"]',
      )!;
      await act(async () => locked.click());
      expect(container.textContent).not.toContain("private-case-input");
      await act(async () => caseButton.click());
      expect(container.textContent).toContain("private-case-input");
    }
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    reducedMotion.mockRestore();
    vi.unstubAllGlobals();
  },
);
