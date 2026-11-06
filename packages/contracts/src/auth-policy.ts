/** @file auth-policy.ts @description Pure session-elevation policy shared by auth, API and UI. @module auth */
/** Recent interactive verification; this is not an MFA assurance claim. */
export const sudoLifetimeSeconds = 15 * 60;
export function sudoExpiresAt(verifiedAt: number | undefined, now: number): number {
  return verifiedAt !== undefined &&
    Number.isSafeInteger(verifiedAt) &&
    verifiedAt <= now &&
    verifiedAt > now - sudoLifetimeSeconds
    ? verifiedAt + sudoLifetimeSeconds
    : 0;
}
