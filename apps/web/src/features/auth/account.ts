import {
  optionalNameSchema,
  usernameSchema,
  emailSchema,
  passwordSchema,
} from "@quorem/contracts/auth";

export class AccountRateLimitError extends Error {
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
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 429)
    throw new AccountRateLimitError(
      data.message ?? "Try again shortly.",
      Number(response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After")) || 60,
    );
  if (!response.ok) throw new Error(data.message ?? "Account update unavailable. Try again.");
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
