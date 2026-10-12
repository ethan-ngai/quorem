/** @file shareInvitation.test.ts @description Native share, fallback and cancellation boundaries. @module matches */
import { expect, it, vi } from "vitest";
import { shareInvitation } from "./shareInvitation";

const url = "https://quorem.example/invite/test";

it("invokes native sharing synchronously from the gesture without copying", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn();
  const result = shareInvitation(url, { share, clipboard: { writeText } });
  expect(share).toHaveBeenCalledWith({ title: "Quorem match", url });
  expect(await result).toBe("shared");
  expect(writeText).not.toHaveBeenCalled();
});

it("copies when native sharing is missing or cannot share the URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  expect(await shareInvitation(url, { clipboard: { writeText } })).toBe("copied");
  const share = vi.fn();
  expect(
    await shareInvitation(url, { share, canShare: () => false, clipboard: { writeText } }),
  ).toBe("copied");
  expect(writeText).toHaveBeenCalledWith(url);
  expect(share).not.toHaveBeenCalled();
});

it("cancels silently without copying", async () => {
  const writeText = vi.fn();
  const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  expect(await shareInvitation(url, { share, clipboard: { writeText } })).toBe("cancelled");
  expect(writeText).not.toHaveBeenCalled();
});

it("surfaces share or clipboard failure for the manual copy recovery", async () => {
  const failure = new DOMException("Blocked", "NotAllowedError");
  const share = vi.fn().mockRejectedValue(failure);
  const writeText = vi.fn().mockRejectedValue(failure);
  await expect(shareInvitation(url, { share, clipboard: { writeText } })).rejects.toBe(failure);
  await expect(shareInvitation(url, { clipboard: { writeText } })).rejects.toBe(failure);
});
