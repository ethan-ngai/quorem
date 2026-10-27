/** @file profile.ts @description Cookie-authenticated account profile and photo transport. @module auth */
import { AuthError } from "./errors";
import { useQuery } from "@tanstack/react-query";
import { tokenDisplay, useSession } from "./session";
export type AccountProfile = {
  id?: string;
  name: string;
  email: string;
  username?: string | null;
  image?: string | null;
  color?: number;
};
export const photoTypes = ["image/jpeg", "image/png", "image/webp"];
export const photoSizeLimit = 5 * 1024 * 1024;
async function readProfile(response: Response): Promise<AccountProfile> {
  if (!response.ok) {
    if (response.status === 401) throw new AuthError("Sign in again to update your profile.");
    if (response.status === 413) throw new AuthError("Choose a photo smaller than 5 MB.");
    if (response.status === 429) throw new AuthError("Too many photo updates. Try again shortly.");
    if (response.status === 400) throw new AuthError("Choose a valid JPEG, PNG, or WebP photo.");
    if (response.status === 415) throw new AuthError("Choose a JPEG, PNG, or WebP photo.");
    throw new AuthError("Profile unavailable. Try again.");
  }
  return response.json() as Promise<AccountProfile>;
}
export async function updateProfileColor(color: number): Promise<AccountProfile> {
  return readProfile(
    await fetch("/api/auth/profile", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    }),
  );
}
export async function fetchProfile(): Promise<AccountProfile> {
  return readProfile(await fetch("/api/auth/profile", { credentials: "same-origin" }));
}
let primed: Promise<AccountProfile> | undefined;
/** Start the cookie-authenticated profile read alongside token/session loading. */
export function primeProfile() {
  if (!primed) {
    primed = fetchProfile();
    void primed.catch(() => {});
  }
}
export async function profileForCurrentAccount(subject?: string) {
  const initial = primed;
  primed = undefined;
  let profile = initial ? await initial : await fetchProfile();
  if (subject && profile.id !== subject) profile = await fetchProfile();
  if (subject && (profile.id !== subject || tokenDisplay()?.subject !== subject))
    throw new AuthError("Account changed. Reload to retry.");
  return profile;
}
export function useProfile(userId?: string) {
  const session = useSession();
  return useQuery({
    queryKey: ["account-profile", userId],
    enabled:
      Boolean(userId) &&
      Boolean(session.data) &&
      session.data?.user.id === userId &&
      (session.data?.mode !== "managed" || Boolean(session.data?.authSubject)),
    queryFn: () => profileForCurrentAccount(session.data?.authSubject),
    staleTime: 30_000,
    retry: false,
  });
}
export async function uploadProfilePhoto(file: File): Promise<AccountProfile> {
  if (!photoTypes.includes(file.type)) throw new AuthError("Choose a JPEG, PNG, or WebP photo.");
  if (!file.size || file.size > photoSizeLimit)
    throw new AuthError("Choose a photo smaller than 5 MB.");
  return readProfile(
    await fetch("/api/auth/profile-photo", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": file.type },
      body: file,
    }),
  );
}
export async function removeProfilePhoto(): Promise<AccountProfile> {
  return readProfile(
    await fetch("/api/auth/profile-photo", { method: "DELETE", credentials: "same-origin" }),
  );
}
