import { afterEach, expect, it, vi } from "vitest";
import type { InterviewRuleEvent } from "@quorem/contracts";
import { createInterviewRuleReporter, createInterviewAlertTracker } from "./ruleEvents";
import { InterviewError } from "./api";
afterEach(() => vi.useRealTimers());
it("retries with one stable key and sends only event kind metadata", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockRejectedValueOnce(new Error("disconnected")).mockResolvedValue({});
  const reporter = createInterviewRuleReporter(send);
  reporter.start();
  reporter.connected(true);
  reporter.report("paste");
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  expect(send.mock.calls[0]?.[0]).toBe("paste");
  expect(send.mock.calls[0]).toHaveLength(2);
  reporter.stop();
});
it("queues while offline, drops unauthorized reports, and cancels retries on teardown", async () => {
  vi.useFakeTimers();
  const send = vi
    .fn()
    .mockRejectedValue(new InterviewError("forbidden", "No longer a candidate", 403));
  const reporter = createInterviewRuleReporter(send);
  reporter.start();
  reporter.report("focus");
  expect(send).not.toHaveBeenCalled();
  reporter.connected(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(1);
  reporter.stop();
  reporter.report("paste");
  expect(send).toHaveBeenCalledTimes(1);
});
it("does not replay historical alerts or duplicate toasts on stale/repeated snapshots", () => {
  const event = (id: string) =>
    ({
      id,
      userId: "candidate",
      name: "Candidate",
      kind: "paste",
      occurredAt: "2026-10-24T23:00:00Z",
    }) as InterviewRuleEvent;
  const track = createInterviewAlertTracker();
  expect(track(5, [event("old")])).toEqual([]);
  expect(track(6, [event("old"), event("new")])).toEqual([event("new")]);
  expect(track(5, [event("old")])).toEqual([]);
  expect(track(6, [event("old"), event("new")])).toEqual([]);
});
