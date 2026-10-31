/** @file cookie.ts @description Scoped guest cookie transport policy. @module identity */
import { guestCookieName, validGuestToken, type GuestKind } from "./credentials.ts";
/** Format only known guest cookies and canonical credentials. */
export function guestSetCookie(
  kind: GuestKind,
  value: string,
  origin: string,
  maxAge: number,
): string {
  if (
    (value !== "" && !validGuestToken(value)) ||
    !Number.isSafeInteger(maxAge) ||
    maxAge < 0 ||
    maxAge > 86400
  )
    throw new Error("Invalid guest cookie");
  const url = new URL(origin),
    ipv4 = url.hostname.split(".");
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    (ipv4.length === 4 &&
      ipv4[0] === "127" &&
      ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255));
  return `${guestCookieName(kind)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === "https:" || !loopback ? "; Secure" : ""}`;
}
