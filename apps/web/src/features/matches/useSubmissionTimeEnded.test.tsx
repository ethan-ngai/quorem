// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSubmissionTimeEnded } from "./useSubmissionTimeEnded";

function Submit({ now, deadline }: { now: string; deadline: string }) {
  return <button disabled={useSubmissionTimeEnded(now, deadline)}>Submit</button>;
}

it("closes at the personal deadline and reopens when a refund restores time", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (now: string, deadline: string) =>
    act(async () => root.render(<Submit now={now} deadline={deadline} />));
  const disabled = () => container.querySelector("button")?.disabled;
  try {
    const deadline = "2026-11-07T12:00:01.000Z";
    await render("2026-11-07T12:00:00.000Z", deadline);
    expect(disabled()).toBe(false);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(disabled()).toBe(true);
    await render("2026-11-07T12:00:00.999Z", deadline);
    expect(disabled()).toBe(true);
    await render("2026-11-07T12:00:01.100Z", "2026-11-07T12:00:30.000Z");
    expect(disabled()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
