/** @file sudo-policy.test.ts @description Recent-proof expiry boundaries without session-refresh extension. @module auth */
import { expect, it } from "vitest";
import { sudoExpiresAt, sudoLifetimeSeconds } from "@quorem/contracts/auth-policy";
it("expires exactly fifteen minutes after verification", () => {
  expect(sudoLifetimeSeconds).toBe(900);
  expect(sudoExpiresAt(1000, 1000)).toBe(1900);
  expect(sudoExpiresAt(1000, 1899)).toBe(1900);
  expect(sudoExpiresAt(1000, 1900)).toBe(0);
});
it.each([undefined, NaN, Infinity, 1001, 999.5])("rejects invalid or future proof %s", (value) => {
  expect(sudoExpiresAt(value, 1000)).toBe(0);
});
