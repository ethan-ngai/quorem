import { AuthError } from "./errors";
import {
  optionalNameSchema,
  usernameSchema,
  emailSchema,
  passwordSchema,
} from "@quorem/contracts/auth";

export class AccountRateLimitError extends AuthError {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message);
  }
}

export async function accountRequest(path: string, body: object) {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { code?: string };
  if (response.status === 429)
    throw new AccountRateLimitError(
      "Too many attempts. Try again shortly.",
      Number(response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After")) || 60,
    );
  if (!response.ok) {
    if (data.code === "USERNAME_IS_ALREADY_TAKEN")
      throw new AuthError("That username is taken. Choose another.");
    if (response.status === 401) throw new AuthError("Sign in again to update your account.");
    if (path === "reset-password" && response.status === 400)
      throw new AuthError("This reset link is invalid or expired. Request a new one.");
    throw new AuthError("Account update unavailable. Please try again.");
  }
}
export async function updateAccount(name: string, username?: string) {
  await accountRequest("update-user", {
    name: optionalNameSchema.parse(name),
    ...(username !== undefined
      ? { username: usernameSchema.parse(username), displayUsername: username }
      : {}),
  });
}
export async function requestEmailChange(email: string) {
  await accountRequest("change-email", {
    newEmail: emailSchema.parse(email),
    callbackURL: `${location.origin}/login?emailChangePending=1&returnTo=%2Fpractice`,
  });
}
export async function requestPasswordReset(email: string) {
  await accountRequest("request-password-reset", {
    email: emailSchema.parse(email),
    redirectTo: `${location.origin}/login?reset=1`,
  });
}
export async function finishPasswordReset(token: string, password: string) {
  await accountRequest("reset-password", { token, newPassword: passwordSchema.parse(password) });
}
