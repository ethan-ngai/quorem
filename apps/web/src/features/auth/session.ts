import { AuthError } from "./errors";
import { useQuery } from "@tanstack/react-query";
import { invalidateAvatarHints } from "./avatarCache";
import { isSignInReturnPath } from "./signInReferral";
export type Session = {
  authSubject?: string;
  avatar?: { name?: string; image?: string; color?: number };
  kind?: "account" | "guest";
  matchId?: string;
  strongUntil?: number;
  capabilities?: {
    hostGuests: boolean;
    authorCustomQuestions: boolean;
    interviewConcurrency: number;
    interviews: boolean;
    hostedIntelligence: boolean;
    experimental: boolean;
    guestConcurrency: number;
  };
  user: { id: string; displayName: string; emailVerified: boolean; role: "user" | "admin" };
  mode: "managed" | "development";
};
/** Browser API calls send the same-origin session cookie. */
export const authenticatedFetch: typeof fetch = (input, init) => {
  const request = new Request(input, { ...init, credentials: "same-origin" });
  request.headers.delete("X-Dev-User");
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
export function sessionQueryOptions() {
  return {
    queryKey: ["auth-session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 30_000,
  } as const;
}
export function useSession() {
  return useQuery(sessionQueryOptions());
}
export function signInDestination(search: string = location.search ?? ""): string {
  const requested = new URLSearchParams(search).get("returnTo") ?? "";
  return isSignInReturnPath(requested) ? requested : "/practice";
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
  invalidateAvatarHints();
  location.assign(signInDestination());
}
export async function signIn(hostedEndpoint: boolean) {
  const response = await fetch(
    hostedEndpoint ? "/api/auth/sign-in/hosted" : "/api/auth/sign-in/social",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(!hostedEndpoint ? { provider: "cognito" } : {}),
        callbackURL: `${location.origin}${signInDestination()}`,
        errorCallbackURL: `${location.origin}/login`,
      }),
    },
  );
  if (!response.ok) throw new AuthError("Sign in unavailable");
  const data = (await response.json()) as { url?: string };
  if (!data.url || new URL(data.url).protocol !== "https:")
    throw new AuthError("Sign in unavailable");
  invalidateAvatarHints();
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
  // A browser subscription is shared by accounts using this device.
  if (navigator.serviceWorker) {
    await navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        if (
          registration?.active?.scriptURL !==
          new URL("/notification-worker.js", location.origin).href
        )
          return;
        await (await registration.pushManager.getSubscription())?.unsubscribe();
      })
      .catch(() => {});
  }
  invalidateAvatarHints();
  location.assign("/practice");
}

/** Ending a guest match removes its credential; it never signs out an account. */
export async function endGuestSession() {
  const response = await fetch("/v1/guest-sessions/end", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok && response.status !== 401) throw new AuthError("Could not end guest session");
}
