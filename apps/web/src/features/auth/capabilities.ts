import { resetToken, signInDestination } from "./session";
import { signInReferral } from "./signInReferral";
export type SocialProvider = "google" | "apple" | "github";
export type AuthCapabilities = {
  method: "password" | "cognito";
  preferredOrigin: string;
  passkey: boolean;
  registration: boolean;
  providers: SocialProvider[];
};
export type Passkey = { id: string; name?: string | null; createdAt?: string | Date | null };
let pendingClient:
  | Promise<
      ReturnType<
        typeof import("better-auth/client").createAuthClient<{
          plugins: [ReturnType<typeof import("@better-auth/passkey/client").passkeyClient>];
        }>
      >
    >
  | undefined;
async function authClient() {
  return (pendingClient ??= Promise.all([
    import("better-auth/client"),
    import("@better-auth/passkey/client"),
  ]).then(([{ createAuthClient }, { passkeyClient }]) =>
    createAuthClient({ plugins: [passkeyClient()] }),
  ));
}
export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const response = await fetch("/api/auth/quorem-config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Sign in unavailable");
  const data = await response.json();
  if (data.method !== "password" && data.method !== "cognito")
    throw new Error("Sign in unavailable");
  return {
    method: data.method,
    preferredOrigin: safeAuthOrigin(data.preferredOrigin),
    passkey: data.passkey === true,
    registration: data.registration === true,
    providers: Array.isArray(data.providers)
      ? data.providers.filter(
          (value: unknown): value is SocialProvider =>
            value === "google" || value === "apple" || value === "github",
        )
      : [],
  };
}
export function supportsPasskeys() {
  return window.isSecureContext && typeof PublicKeyCredential !== "undefined";
}
export async function signInWithPasskey(search?: string) {
  if (!supportsPasskeys()) throw new Error("Passkeys are unavailable in this browser.");
  const result = await (await authClient()).signIn.passkey();
  if (result.error) throw new Error(result.error.message || "Passkey sign in cancelled or failed.");
  resetToken();
  location.assign(signInDestination(search));
}
export async function addPasskey(name = "My passkey") {
  if (!supportsPasskeys()) throw new Error("Passkeys are unavailable in this browser.");
  const result = await (await authClient()).passkey.addPasskey({ name });
  if (result.error) throw new Error(result.error.message || "Could not add passkey.");
}
export async function listPasskeys(): Promise<Passkey[]> {
  const result = await (await authClient()).passkey.listUserPasskeys();
  if (result.error) throw new Error(result.error.message || "Could not load passkeys.");
  return result.data ?? [];
}
export async function deletePasskey(id: string) {
  const result = await (await authClient()).passkey.deletePasskey({ id });
  if (result.error) throw new Error(result.error.message || "Could not remove passkey.");
}
export async function signInWithProvider(provider: SocialProvider, search?: string) {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: `${location.origin}${signInDestination(search)}`,
      errorCallbackURL: `${location.origin}/login`,
    }),
  });
  if (!response.ok) throw new Error("Sign in unavailable");
  const data = await response.json();
  if (!data.url || new URL(data.url).protocol !== "https:") throw new Error("Sign in unavailable");
  location.assign(data.url);
}

/** Only the same origin or same-port loopback alias can canonicalize local login. */
function safeAuthOrigin(value: unknown): string {
  if (typeof value !== "string") return location.origin;
  const url = new URL(value);
  const current = new URL(location.origin);
  if (
    url.origin === value &&
    (url.origin === current.origin ||
      (url.protocol === current.protocol &&
        url.port === current.port &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        ["localhost", "127.0.0.1"].includes(current.hostname)))
  )
    return value;
  throw new Error("Sign in unavailable");
}

export type Registration = { name: string; username: string; email: string; password: string };
function verificationCallback(search?: string) {
  const callback = new URL("/login", location.origin);
  callback.searchParams.set("verified", "1");
  callback.searchParams.set("returnTo", signInDestination(search));
  const backTo = signInReferral(search ?? location.search, "", location.origin);
  if (backTo) callback.searchParams.set("backTo", backTo);
  return callback.toString();
}
export async function registerAccount(account: Registration, search?: string) {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...account, callbackURL: verificationCallback(search) }),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many attempts. Try again shortly.");
    throw new Error("Could not create account. Check your details and try again.");
  }
}
export async function resendVerificationEmail(email: string, search?: string) {
  const response = await fetch("/api/auth/send-verification-email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: verificationCallback(search) }),
  });
  if (!response.ok) throw new Error("Could not send verification email. Try again shortly.");
}
