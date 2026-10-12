import type { DevelopmentIdentity } from "@quorem/contracts";
import { readPreference } from "../editor/editorSettings";
import { useQuery } from "@tanstack/react-query";
export type Session = {
  user: { id: string; displayName: string; emailVerified: boolean; role: "user" | "admin" };
  mode: "managed" | "development";
};
let access: { token: string; until: number } | undefined;
let pending: Promise<string | undefined> | undefined;
export async function token(): Promise<string | undefined> {
  if (access && access.until > Date.now()) return access.token;
  if (pending) return pending;
  pending = fetch("/api/auth/token", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const data = (await response.json()) as { token?: string };
      if (data.token) access = { token: data.token, until: Date.now() + 240_000 };
      return data.token;
    })
    .catch(() => undefined)
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
/** Bearer tokens stay in memory; local headers never reach managed requests. */
export const authenticatedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const bearer = await token();
  if (bearer) {
    request.headers.delete("X-Dev-User");
    request.headers.set("Authorization", `Bearer ${bearer}`);
  }
  return fetch(request);
};
export async function fetchSession(identity: DevelopmentIdentity): Promise<Session | null> {
  const response = await authenticatedFetch(
    new Request(new URL("/v1/session", window.location.origin), {
      headers: { "X-Dev-User": identity },
    }),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Account unavailable");
  return response.json() as Promise<Session>;
}
export function useSession(
  identity: DevelopmentIdentity = readPreference("quorem.dev-identity.v1", "alice"),
) {
  return useQuery({
    queryKey: ["auth-session", identity],
    queryFn: () => fetchSession(identity),
    retry: false,
    staleTime: 30_000,
  });
}
export async function signIn() {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "cognito",
      callbackURL: `${location.origin}/practice`,
      errorCallbackURL: `${location.origin}/login`,
    }),
  });
  if (!response.ok) throw new Error("Sign in unavailable");
  const data = (await response.json()) as { url?: string };
  if (!data.url || new URL(data.url).protocol !== "https:") throw new Error("Sign in unavailable");
  location.assign(data.url);
}
export async function signOut() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Sign out unavailable");
  access = undefined;
  location.assign("/practice");
}
