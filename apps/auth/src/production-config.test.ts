import { describe, expect, it } from "vitest";
import { productionAuthEnvironment } from "./production-config";
import { configuration } from "./config";

const base = {
  AUTH_ORIGIN: "https://quorem.app",
  BETTER_AUTH_SECRET: "a".repeat(32),
  AUTH_INTERNAL_SECRET: "fixture",
};
const smtp = {
  SMTP_USERNAME: "accounts@example.com",
  SMTP_PASSWORD: "fixture-smtp-password",
  AUTH_EMAIL_FROM: "Quorem <accounts@example.com>",
};

describe("production auth composition", () => {
  it("retains login-only mode until email is configured", () => {
    expect(productionAuthEnvironment(base)).toEqual({ AUTH_LOGIN_ONLY: "true" });
  });

  it("enables registration through authenticated Purelymail TLS", () => {
    const runtime = productionAuthEnvironment({ ...base, ...smtp });
    const config = configuration({
      ...base,
      ...runtime,
      AUTH_DATABASE_URL: "postgres://fixture",
      APP_ENV: "production",
      AUTH_MODE: "password",
      AUTH_PASSWORD_PRODUCTION: "true",
    });
    expect(config.registration).toBe(true);
    expect(config.mail).toMatchObject({
      driver: "smtp",
      host: "smtp.purelymail.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: smtp.SMTP_USERNAME, pass: smtp.SMTP_PASSWORD },
    });
    expect(runtime).not.toHaveProperty("BETTER_AUTH_SECRET");
  });

  it.each(["SMTP_USERNAME", "SMTP_PASSWORD", "AUTH_EMAIL_FROM"])(
    "rejects partial email configuration missing %s",
    (key) => {
      expect(() => productionAuthEnvironment({ ...base, ...smtp, [key]: undefined })).toThrow(
        `${key} required`,
      );
    },
  );

  it.each(["GOOGLE", "GITHUB"])("maps complete %s OAuth credentials", (provider) => {
    const runtime = productionAuthEnvironment({
      ...base,
      [`AUTH_${provider}_CLIENT_ID`]: "fixture-id",
      [`AUTH_${provider}_CLIENT_SECRET`]: "fixture-secret",
    });
    expect(runtime[`${provider}_CLIENT_ID`]).toBe("fixture-id");
    expect(runtime[`${provider}_CLIENT_SECRET`]).toBe("fixture-secret");
    expect(() =>
      productionAuthEnvironment({ ...base, [`AUTH_${provider}_CLIENT_ID`]: "fixture-id" }),
    ).toThrow(`${provider} requires both`);
  });

  it("leaves Apple disabled even if credentials are present", () => {
    expect(productionAuthEnvironment({
      ...base,
      AUTH_APPLE_CLIENT_ID: "fixture-id",
      AUTH_APPLE_CLIENT_SECRET: "fixture-secret",
    })).not.toHaveProperty("APPLE_CLIENT_ID");
  });

  it("rejects sender header injection", () => {
    expect(() =>
      productionAuthEnvironment({ ...base, ...smtp, AUTH_EMAIL_FROM: "a@example.com\r\nBcc: x" }),
    ).toThrow("Invalid email sender");
  });
});
