/** @file shareLink.ts @description Shared native link sharing and clipboard fallback. @module ui */
export type ShareLinkData = { title: string; text?: string; url: string };
export type ShareBrowser = { clipboard: Pick<Clipboard, "writeText"> } & Partial<
  Pick<Navigator, "share" | "canShare">
>;

export function canShareLink(
  data: ShareLinkData,
  browser: Partial<ShareBrowser> = typeof navigator === "undefined" ? {} : navigator,
) {
  try {
    return !!browser.share && (!browser.canShare || browser.canShare(data));
  } catch {
    return false;
  }
}

/** Invoke before any await to retain the user's native-share activation. */
export async function shareLink(
  data: ShareLinkData,
  browser: ShareBrowser = navigator,
): Promise<"shared" | "copied" | "cancelled"> {
  if (!canShareLink(data, browser)) {
    await browser.clipboard.writeText(data.url);
    return "copied";
  }
  try {
    await browser.share!(data);
    return "shared";
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") return "cancelled";
    throw cause;
  }
}
