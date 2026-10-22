import { AuthError } from "./errors";
import { useQuery } from "@tanstack/react-query";
export type Session = {
  kind?: "account" | "guest";
  matchId?: string;
  strongUntil?: number;
  capabilities?: {
    hostGuests: boolean;
    hostedIntelligence: boolean;
    experimental: boolean;
    guestJobs: number;
    guestSeconds: number;
    guestConcurrency: number;
  };
  user: { id: string; displayName: string; emailVerified: boolean; role: "user" | "admin" };
  mode: "managed" | "development";
};
let access: { token: string; until: number } | undefined;
let pending: Promise<string | undefined> | undefined;
let generation = 0;
export function resetToken() {
  generation++;
  access = undefined;
  pending = undefined;
}
export async function token(): Promise<string | undefined> {
  if (access && access.until > Date.now()) return access.token;
  if (pending) return pending;
  const requestedGeneration = generation;
  const request = fetch("/api/auth/token", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) return undefined;
      const data = (await response.json()) as { token?: string };
      if (requestedGeneration !== generation) return undefined;
      if (data.token) access = { token: data.token, until: Date.now() + 240_000 };
      return data.token;
    })
    .catch(() => undefined)
    .finally(() => {
      if (pending === request) pending = undefined;
    });
  pending = request;
  return request;
}
/** Bearer tokens stay in memory; local headers never reach managed requests. */
export const authenticatedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const bearer = await token();
  request.headers.delete("X-Dev-User");
  if (bearer) {
    request.headers.set("Authorization", `Bearer ${bearer}`);
  }
  return fetch(request);
};
export async function fetchSession(): Promise<Session | null> {
  const response = await authenticatedFetch(
    new Request(new URL("/v1/session", window.location.origin)),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new AuthError("Account unavailable");
  return response.json() as Promise<Session>;
}
export function useSession() {
  return useQuery({
    queryKey: ["auth-session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 30_000,
  });
}
export async function authMethod(): Promise<"password" | "cognito"> {
  const response = await fetch("/api/auth/quorem-config", { credentials: "same-origin" });
  if (!response.ok) throw new AuthError("Sign in unavailable");
  const data = (await response.json()) as { method?: string };
  if (data.method !== "password" && data.method !== "cognito")
    throw new AuthError("Sign in unavailable");
  return data.method;
}
export function signInDestination(search: string = location.search ?? ""): string {
  const requested = new URLSearchParams(search).get("returnTo") ?? "";
  return /^\/(practice|match|invite|admin)(\/|\?|#|$)/.test(requested) &&
    !requested.includes("\\") &&
    !/[\r\n]/.test(requested)
    ? requested
    : "/practice";
}
export async function signInWithPassword(username: string, password: string) {
  const response = await fetch(
    username.includes("@") ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        username.includes("@") ? { email: username, password } : { username, password },
      ),
    },
  );
  if (!response.ok) {
    if (response.status === 403) {
      const error = (await response.json().catch(() => ({}))) as { code?: string };
      if (error.code === "EMAIL_NOT_VERIFIED")
        throw new AuthError(
          "Verify your email first. Choose Create account to request a setup link.",
        );
    }
    if (response.status === 429) throw new AuthError("Too many attempts. Try again shortly.");
    if (response.status >= 500) throw new AuthError("Sign in unavailable. Try again.");
    throw new AuthError("Incorrect username, email or password.");
  }
  resetToken();
  location.assign(signInDestination());
}
export async function signIn() {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "cognito",
      callbackURL: `${location.origin}${signInDestination()}`,
      errorCallbackURL: `${location.origin}/login`,
    }),
  });
  if (!response.ok) throw new AuthError("Sign in unavailable");
  const data = (await response.json()) as { url?: string };
  if (!data.url || new URL(data.url).protocol !== "https:")
    throw new AuthError("Sign in unavailable");
  location.assign(data.url);
}
export async function signOut() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new AuthError("Sign out unavailable");
  resetToken();
  location.assign("/practice");
}
