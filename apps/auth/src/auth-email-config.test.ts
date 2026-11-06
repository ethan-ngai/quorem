/** @file auth-email-config.test.ts @description Verification redirects and plugin wiring. @module auth */
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth.ts";
import { configuration } from "./config.ts";
import { socialEmail } from "./social-email.ts";
import type { AuthRepository } from "./auth-repository.ts";
import { accountEmails } from "./emails/content.ts";

const origin = "http://localhost:5180";
describe("Better Auth account email configuration", () => {
  it.each([
    ["/", "verified=1", accountEmails.registration.subject],
    [
      "/login?verified=1&returnTo=%2Fpractice",
      "returnTo=%2Fpractice",
      accountEmails.registration.subject,
    ],
    ["/login?emailChangePending=1", "emailChanged=1", accountEmails.verify.subject],
  ])("preserves the purpose of callback %s", async (callback, expected, subject) => {
    const accountMail = vi.fn();
    const config = configuration({
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: origin,
      AUTH_LOGIN_ONLY: "true",
      BETTER_AUTH_SECRET: "test-secret-".repeat(4),
      AUTH_DATABASE_URL: "postgres://unused",
      AUTH_INTERNAL_SECRET: "fixture",
    });
    const options = {
      config,
      accountMail,
      adapter: undefined,
      emailFlow: socialEmail({} as AuthRepository, origin),
      rateLimit: async () => ({ allowed: true, retryAfter: 0 }),
      profile: async () => undefined,
      recordAssurance: async () => {},
      checkAssurance: async () => ({ valid: true, strongAt: undefined }),
    };
    const auth = createAuth(options);
    const url = new URL("/api/auth/verify-email", origin);
    url.searchParams.set("callbackURL", callback);
    await auth.options.emailVerification?.sendVerificationEmail?.({
      user: { email: "reader@example.test" },
      url: url.toString(),
    });
    expect(accountMail).toHaveBeenCalledWith(
      "reader@example.test",
      expect.stringContaining(encodeURIComponent(expected)),
      subject,
      expect.any(String),
    );
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toContain("last-login-method");
  });
});
