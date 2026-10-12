/** @file shareInvitation.ts @description Native invitation sharing with clipboard fallback. @module matches */
type ShareBrowser = { clipboard: Pick<Clipboard, "writeText"> } & Partial<
  Pick<Navigator, "share" | "canShare">
>;

/** Opens the native share sheet directly from a click; unsupported browsers copy instead. */
export async function shareInvitation(
  url: string,
  browser: ShareBrowser = navigator,
): Promise<"shared" | "copied" | "cancelled"> {
  const data = { title: "Quorem · Showdown", url };
  if (!browser.share || (browser.canShare && !browser.canShare(data))) {
    await browser.clipboard.writeText(url);
    return "copied";
  }
  try {
    await browser.share(data);
    return "shared";
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") return "cancelled";
    throw cause;
  }
}
