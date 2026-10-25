import { expect, it, vi } from "vitest";
import { createClipboardProvenance } from "./clipboardProvenance";
it("exempts same-tab copy and cut text, even when hashing is still pending", async () => {
  const clipboard = createClipboardProvenance();
  void clipboard.remember("internal\r\ncode");
  expect(await clipboard.isInternal("internal\ncode")).toBe(true);
  expect(await clipboard.isInternal("external code")).toBe(false);
  expect(await createClipboardProvenance().isInternal("internal\ncode")).toBe(false);
});
it("keeps a bounded recent-copy history and does not whitelist empty clipboard data", async () => {
  const clipboard = createClipboardProvenance(2);
  await clipboard.remember("first");
  await clipboard.remember("second");
  await clipboard.remember("third");
  expect(await clipboard.isInternal("first")).toBe(false);
  expect(await clipboard.isInternal("second")).toBe(true);
  expect(await clipboard.isInternal("")).toBe(false);
});

it("recognizes internal copies on private-IP HTTP without Web Crypto", async () => {
  vi.stubGlobal("crypto", {});
  try {
    const clipboard = createClipboardProvenance();
    await clipboard.remember("same-tab source");
    expect(await clipboard.isInternal("same-tab source")).toBe(true);
    expect(await clipboard.isInternal("external source")).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
