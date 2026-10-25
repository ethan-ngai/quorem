/** @file shareLink.test.ts @description Native share metadata, capability failure and cancellation. @module ui */
import { it, expect, vi } from "vitest";
import { canShareLink, shareLink } from "./shareLink";
const data = {
  title: "Ledger · Quorem",
  text: "Join Ledger on Quorem as an interviewer.",
  url: "https://quorem.example/interview-invite/test",
};
it("shares the supplied role and session metadata directly from the gesture", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn();
  const pending = shareLink(data, { share, clipboard: { writeText } });
  expect(share).toHaveBeenCalledWith(data);
  expect(await pending).toBe("shared");
  expect(writeText).not.toHaveBeenCalled();
});
it("gates unavailable native sharing and copies only the URL", async () => {
  const browser = {
    clipboard: { writeText: vi.fn() },
    share: vi.fn(),
    canShare: () => {
      throw new Error("blocked");
    },
  };
  expect(canShareLink(data, browser)).toBe(false);
  expect(await shareLink(data, browser)).toBe("copied");
  expect(browser.clipboard.writeText).toHaveBeenCalledWith(data.url);
});
it("cancels without copying or sending a second action", async () => {
  const browser = {
    clipboard: { writeText: vi.fn() },
    share: vi.fn().mockRejectedValue(new DOMException("Cancel", "AbortError")),
  };
  expect(await shareLink(data, browser)).toBe("cancelled");
  expect(browser.clipboard.writeText).not.toHaveBeenCalled();
});
