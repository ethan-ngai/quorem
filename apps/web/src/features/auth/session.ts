import { AuthError } from "./errors";
import { useQuery } from "@tanstack/react-query";
import { invalidateAvatarHints } from "./avatarCache";
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
let access: { token: string; until: number } | undefined;
/** Display hints only; the API verifies the bearer and all permissions. */
export function tokenDisplay(value = access?.token) {
  try {
    if (!value) return undefined;
    const payload = value.split(".")[1]!;
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (typeof data.sub !== "string" || !data.sub) return undefined;
    return {
      subject: data.sub,
      name: typeof data.name === "string" ? data.name : undefined,
      image:
        typeof data.image === "string" &&
        /^\/api\/auth\/profile-photos\/[a-f0-9-]{36}$/.test(data.image)
          ? data.image
          : undefined,
      color:
        typeof data.color === "number" &&
        Number.isInteger(data.color) &&
        data.color >= 1 &&
        data.color <= 24
          ? data.color
          : undefined,
    };
  } catch {
    return undefined;
  }
}
/** Expiry is scheduling metadata only; the server verifies every bearer. */
export function tokenExpiresAt(): number | undefined {
  return access?.until;
}
function expiry(value: string): number {
  try {
    const payload = value.split(".")[1]!;
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    if (typeof data.exp === "number" && Number.isFinite(data.exp)) return data.exp * 1000;
  } catch {
    /* Development token fixtures need not be JWTs. */
  }
  return Date.now() + 300_000;
}
let anonymousUntil = 0;
let pending: Promise<string | undefined> | undefined;
let generation = 0;
const responseBearers = new WeakMap<Response, string>();
export function resetToken() {
  generation++;
  anonymousUntil = 0;
  access = undefined;
  pending = undefined;
}
export async function token(): Promise<string | undefined> {
  if (access && access.until - 30_000 > Date.now()) return access.token;
  if (anonymousUntil > Date.now()) return undefined;
  if (pending) return pending;
  const requestedGeneration = generation;
  const request = fetch("/api/auth/token", {
    credentials: "same-origin",
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (response) => {
      if (!response.ok) {
        // Polling guests must not repeatedly hit the account-token service.
        if (response.status === 401) {
          if (requestedGeneration === generation) {
            access = undefined;
            anonymousUntil = Date.now() + 30_000;
          }
          return undefined;
        }
        throw new AuthError("Account temporarily unavailable. Try again.");
      }
      const data = (await response.json()) as { token?: string };
      if (requestedGeneration !== generation) return undefined;
      if (!data.token) throw new AuthError("Account temporarily unavailable. Try again.");
      access = { token: data.token, until: expiry(data.token) };
      return data.token;
    })
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
  // Retry a rejected bearer once with the current account session. Preserve body/retry keys.
  const response = await fetch(request.clone());
  if (response.status !== 401 || !bearer) {
    if (bearer) responseBearers.set(response, bearer);
    return response;
  }
  resetToken();
  const refreshed = await token();
  if (!refreshed) return response;
  await response.body?.cancel();
  request.headers.set("Authorization", `Bearer ${refreshed}`);
  const retried = await fetch(request);
  responseBearers.set(retried, refreshed);
  return retried;
};
export async function fetchSession(): Promise<Session | null> {
  const response = await authenticatedFetch(
    new Request(new URL("/v1/session", window.location.origin)),
  );
  if (response.status === 401) return null;
  if (!response.ok) throw new AuthError("Account unavailable");
  const session = (await response.json()) as Session;
  const used = responseBearers.get(response);
  const display = used && used === access?.token ? tokenDisplay(used) : undefined;
  if (session.kind !== "guest" && display) {
    session.authSubject = display.subject;
    session.avatar = { name: display.name, image: display.image, color: display.color };
  }
  return session;
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
  return /^\/(practice|match|invite|admin|interviews|interview|interview-invite)(\/|\?|#|$)/.test(
    requested,
  ) &&
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
  resetToken();
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
