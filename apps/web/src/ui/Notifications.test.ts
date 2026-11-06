import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { notifyBatchResult, notificationAction } from "./Notifications";

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("releases toast focus before opening details", () => {
  const frames: (() => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  const blur = vi.fn(),
    details = vi.fn();
  notificationAction("Details", details).onClick({ currentTarget: { blur } } as never);
  expect(blur).toHaveBeenCalledOnce();
  expect(details).not.toHaveBeenCalled();
  frames[0]!();
  expect(details).toHaveBeenCalledOnce();
});

it("announces success without a zero-failure count", () => {
  notifyBatchResult({ id: "bulk", verb: "Deleted", noun: "question", succeeded: 100, failed: 0 });
  expect(toast.success).toHaveBeenCalledWith("Deleted 100 questions", { id: "bulk" });
  expect(toast.warning).not.toHaveBeenCalled();
});

it("discloses partial failures through an actionable toast", () => {
  const details = vi.fn();
  notifyBatchResult({
    id: "bulk",
    verb: "Published",
    noun: "question",
    succeeded: 97,
    failed: 3,
    onDetails: details,
  });
  expect(toast.warning).toHaveBeenCalledWith(
    "Published 97 questions",
    expect.objectContaining({
      description: "3 need attention.",
      action: { label: "Details", onClick: expect.any(Function) },
    }),
  );
});

it("does not claim success when every item failed", () => {
  notifyBatchResult({ id: "bulk", verb: "Processed", noun: "file", succeeded: 0, failed: 1 });
  expect(toast.error).toHaveBeenCalledWith("1 file needs attention", { id: "bulk" });
  expect(toast.success).not.toHaveBeenCalled();
});

it("dismisses empty batches instead of announcing zero counts", () => {
  notifyBatchResult({ id: "bulk", verb: "Deleted", noun: "question", succeeded: 0, failed: 0 });
  expect(toast.dismiss).toHaveBeenCalledWith("bulk");
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
