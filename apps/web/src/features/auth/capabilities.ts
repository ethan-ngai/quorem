import { AuthError, passkeyError, registrationError } from "./errors";
import { fetchSession, resetToken, signInDestination } from "./session";
import { signInReferral } from "./signInReferral";
import { invalidateAvatarHints } from "./avatarCache";
export const socialProviderLabels = { google: "Google", github: "GitHub" } as const;
export type SocialProvider = keyof typeof socialProviderLabels;
export const socialProviders = Object.keys(socialProviderLabels) as SocialProvider[];
export type AuthCapabilities = {
  method: "password" | "hosted";
  hostedEndpoint: boolean;
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
          plugins: [
            ReturnType<typeof import("@better-auth/passkey/client").passkeyClient>,
            ReturnType<typeof import("better-auth/client/plugins").lastLoginMethodClient>,
          ];
        }>
      >
    >
  | undefined;
async function authClient() {
  return (pendingClient ??= Promise.all([
    import("better-auth/client"),
    import("@better-auth/passkey/client"),
    import("better-auth/client/plugins"),
  ]).then(([{ createAuthClient }, { passkeyClient }, { lastLoginMethodClient }]) =>
    createAuthClient({ plugins: [passkeyClient(), lastLoginMethodClient()] }),
  ));
}
/** Cookie is a presentation hint, never evidence of identity or assurance. */
export async function lastLoginMethod() {
  return (await authClient()).getLastUsedLoginMethod();
}
export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const response = await fetch("/api/auth/quorem-config", { credentials: "same-origin" });
  if (!response.ok) throw new AuthError("Sign in unavailable");
  const data = await response.json();
  if (data.hostedSignIn !== true && data.method !== "password" && data.method !== "cognito")
    throw new AuthError("Sign in unavailable");
  return {
    method: data.hostedSignIn === true || data.method === "cognito" ? "hosted" : "password",
    hostedEndpoint: data.hostedSignIn === true,
    preferredOrigin: safeAuthOrigin(data.preferredOrigin),
    passkey: data.passkey === true,
    registration: data.registration === true,
    providers: Array.isArray(data.providers)
      ? data.providers.filter(
          (value: unknown): value is SocialProvider =>
            typeof value === "string" && Object.hasOwn(socialProviderLabels, value),
        )
      : [],
  };
}
export function supportsPasskeys() {
  return window.isSecureContext && typeof PublicKeyCredential !== "undefined";
}
async function passkeyRequest<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw passkeyError(error);
  }
}
/** Verifies in place so protected actions retain their selection and progress. */
export async function verifyWithPasskey() {
  const before = await fetchSession();
  if (!before) throw new AuthError("Sign in again to continue.");
  await authenticateWithPasskey();
  const after = await fetchSession();
  if (!after || before.user.id !== after.user.id)
    throw new AuthError("Account changed. Reload before continuing.");
}
async function authenticateWithPasskey() {
  if (!supportsPasskeys()) throw new AuthError("Passkeys are unavailable in this browser.");
  const result = await passkeyRequest(async () => (await authClient()).signIn.passkey());
  if (result.error) throw passkeyError(result.error);
  resetToken();
  invalidateAvatarHints();
}
export async function signInWithPasskey(search?: string) {
  await authenticateWithPasskey();
  location.assign(signInDestination(search));
}
export async function addPasskey(name = "My passkey") {
  if (!supportsPasskeys()) throw new AuthError("Passkeys are unavailable in this browser.");
  const result = await passkeyRequest(async () =>
    (await authClient()).passkey.addPasskey({ name }),
  );
  if (result.error) throw passkeyError(result.error);
}
export async function listPasskeys(): Promise<Passkey[]> {
  const result = await (await authClient()).passkey.listUserPasskeys();
  if (result.error) throw passkeyError(result.error);
  return result.data ?? [];
}
export async function deletePasskey(id: string) {
  const result = await (await authClient()).passkey.deletePasskey({ id });
  if (result.error) throw passkeyError(result.error);
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
  if (!response.ok) throw new AuthError("Sign in unavailable");
  const data = await response.json();
  if (!data.url || new URL(data.url).protocol !== "https:")
    throw new AuthError("Sign in unavailable");
  invalidateAvatarHints();
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
  throw new AuthError("Sign in unavailable");
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
async function registrationRequest(path: string, body?: object) {
  const response = await fetch(`/api/auth/registration/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw registrationError(data.message);
  return data;
}
export async function beginRegistration(
  email: string,
  search?: string,
): Promise<{ retryAfter: number }> {
  return registrationRequest("start", { email, callbackURL: verificationCallback(search) });
}
export async function registrationStatus(
  token?: string,
): Promise<{ email: string; registered: boolean }> {
  if (token) await registrationRequest("verify", { token });
  return registrationRequest("status");
}
export async function completeRegistration(
  email: string,
  username: string,
  password: string,
  name?: string,
): Promise<void> {
  await registrationRequest("complete", { email, username, password, name });
}
