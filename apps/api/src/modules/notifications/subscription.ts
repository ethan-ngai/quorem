/** @file subscription.ts @description Validate outbound subscription endpoints at both trust boundaries. @module notifications */
export function browserPushEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return;
    const host = url.hostname;
    if (
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.apple.com") ||
      host === "web.push.apple.com" ||
      host.endsWith(".notify.windows.com")
    )
      return url.href;
  } catch {
    // Push endpoints are supplied by the browser and may be stale or malformed.
  }
}
