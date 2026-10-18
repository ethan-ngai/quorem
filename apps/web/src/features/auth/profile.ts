/** @file profile.ts @description Cookie-authenticated account profile and photo transport. @module auth */
import { AuthError } from "./errors";
import { useQuery } from "@tanstack/react-query";
export type AccountProfile = {
  name: string;
  email: string;
  username?: string | null;
  image?: string | null;
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
export async function fetchProfile(): Promise<AccountProfile> {
  return readProfile(await fetch("/api/auth/profile", { credentials: "same-origin" }));
}
export function useProfile(userId?: string) {
  return useQuery({
    queryKey: ["account-profile", userId],
    enabled: Boolean(userId),
    queryFn: fetchProfile,
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
