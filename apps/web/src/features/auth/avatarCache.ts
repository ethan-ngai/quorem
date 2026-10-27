/** @file avatarCache.ts @description Tab-local, display-only avatar hints. @module auth */
export type AvatarHint = {
  userId: string;
  name: string;
  image?: string;
  color?: number;
  savedAt: number;
  epoch?: string;
};
const key = "quorem.avatar-hint.v1";
const epochKey = "quorem.avatar-hint-epoch.v1";
const maxAge = 24 * 60 * 60_000;
function epoch() {
  try {
    return localStorage.getItem(epochKey) ?? "";
  } catch {
    return "";
  }
}

export function readAvatarHint(): AvatarHint | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as AvatarHint | null;
    if (
      !value ||
      typeof value.userId !== "string" ||
      !value.userId ||
      (value.epoch ?? "") !== epoch() ||
      typeof value.name !== "string" ||
      typeof value.savedAt !== "number" ||
      value.savedAt > Date.now() ||
      Date.now() - value.savedAt > maxAge ||
      (value.image !== undefined &&
        (typeof value.image !== "string" ||
          !/^\/api\/auth\/profile-photos\/[a-f0-9-]{36}$/.test(value.image))) ||
      (value.color !== undefined &&
        (!Number.isInteger(value.color) || value.color < 1 || value.color > 24))
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
export function writeAvatarHint(value: Omit<AvatarHint, "savedAt" | "epoch">) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now(), epoch: epoch() }));
  } catch {}
}
export function clearAvatarHint() {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
/** Invalidate hints in other tabs when the account session changes. */
export function invalidateAvatarHints() {
  clearAvatarHint();
  try {
    localStorage.setItem(epochKey, `${Date.now()}:${Math.random()}`);
  } catch {}
}
