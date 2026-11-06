// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamVote } from "@quorem/contracts/factions";
import { TeamVoteToast } from "./TeamVoteToast";
vi.mock("../../ui/PersistentActionToast", () => ({
  PersistentActionToast: ({ children }: { children: React.ReactNode }) => children,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const fixture = (): TeamVote => ({
  id: "vote",
  proposerId: "a",
  electorate: ["a", "b", "c"],
  ballots: { a: true },
  quote: {
    ruleVersion: "1",
    action: { kind: "reveal", target: "topics" },
    cost: { seconds: 30, points: 5 },
  },
  state: "pending",
  createdAt: Date.now(),
  expiresAt: Date.now() + 30000,
});
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
it("admits one pending request and disables expired ballots", async () => {
  const vote = fixture();
  let finish!: () => void;
  const onVote = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <TeamVoteToast
        vote={vote}
        identity="b"
        proposerName="Alex"
        serverNow={Date.now()}
        onVote={onVote}
        onCancel={async () => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("+30s time penalty · −5 points");
  expect(container.textContent).toContain("1/2 approvals");
  await act(async () => {
    button("Approve").click();
    button("Approve").click();
  });
  expect(onVote).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await act(async () => vi.advanceTimersByTime(30000));
  expect(button("Approve").disabled).toBe(true);
  expect(button("Reject").disabled).toBe(true);
  await act(async () => button("Approve").click());
  expect(onVote).toHaveBeenCalledTimes(1);
});
it("preserves the proposed source when reviewing the snapshot", async () => {
  const vote = fixture();
  vote.quote.action = {
    kind: "submit",
    workspaceId: "w",
    level: 1,
    source: "original source",
    language: "python",
    documentEpoch: "e",
    documentVersion: 1,
  };
  await act(async () =>
    root.render(
      <TeamVoteToast
        vote={vote}
        identity="a"
        proposerName="Alex"
        serverNow={Date.now()}
        onVote={async () => {}}
        onCancel={async () => {}}
      />,
    ),
  );
  await act(async () => button("Review").click());
  expect(container.querySelector("pre")?.textContent).toBe("original source");
  expect(button("Cancel proposal")).toBeDefined();
  expect(button("Hide").getAttribute("aria-expanded")).toBe("true");
});
