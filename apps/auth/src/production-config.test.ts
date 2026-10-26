import { describe, expect, it } from "vitest";
import { productionAuthConfiguration, productionAuthEnvironment } from "./production-config";
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

  it("treats unset Actions variables as absent", () => {
    const empty = {
      AUTH_MODE: "",
      AUTH_EMAIL_DRIVER: "",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USERNAME: "",
      SMTP_PASSWORD: "",
      AUTH_EMAIL_FROM: "",
      AUTH_EMAIL_SES_REGION: "",
      AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "",
      AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "",
    };
    expect(productionAuthEnvironment({ ...base, ...empty })).toEqual({ AUTH_LOGIN_ONLY: "true" });
    const configured = {
      ...base,
      ...empty,
      ...smtp,
      AUTH_EMAIL_DRIVER: "smtp",
      SMTP_HOST: "smtp.example.com",
    };
    const runtime = productionAuthEnvironment(configured);
    expect(productionAuthConfiguration(configured, runtime).mail).toMatchObject({ port: 465 });
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
        key === "AUTH_EMAIL_FROM" ? `${key} required` : "SMTP credentials required",
      );
    },
  );

  it.each([
    [
      { ...smtp, AUTH_EMAIL_DRIVER: "smtp", SMTP_HOST: "smtp.example.com", SMTP_PORT: "587" },
      "smtp",
    ],
    [{ ...smtp, AUTH_EMAIL_DRIVER: "ses-smtp", AUTH_EMAIL_SES_REGION: "us-east-1" }, "ses-smtp"],
    [
      {
        AUTH_EMAIL_DRIVER: "cloudflare",
        AUTH_EMAIL_FROM: smtp.AUTH_EMAIL_FROM,
        AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "token",
      },
      "cloudflare",
    ],
  ])("uses the selected email adapter", (mail, driver) => {
    const env = { ...base, ...mail };
    const runtime = productionAuthEnvironment(env);
    const config = configuration({
      ...env,
      ...runtime,
      AUTH_DATABASE_URL: "postgres://fixture",
      APP_ENV: "production",
      AUTH_MODE: "password",
      AUTH_PASSWORD_PRODUCTION: "true",
    });
    expect(config.mail?.driver).toBe(driver);
    expect(config.registration).toBe(true);
  });

  it("honors Cognito mode without forcing login-only", () => {
    const env = {
      ...base,
      AUTH_MODE: "cognito",
      COGNITO_CLIENT_ID: "id",
      COGNITO_CLIENT_SECRET: "secret",
      COGNITO_DOMAIN: "domain",
      COGNITO_REGION: "region",
      COGNITO_USERPOOL_ID: "pool",
    };
    const runtime = productionAuthEnvironment(env);
    expect(runtime.AUTH_LOGIN_ONLY).toBe("false");
    expect(runtime.COGNITO_CLIENT_SECRET).toBe("secret");
    expect(productionAuthConfiguration(env, runtime).method).toBe("cognito");
  });

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
    expect(
      productionAuthEnvironment({
        ...base,
        AUTH_APPLE_CLIENT_ID: "fixture-id",
        AUTH_APPLE_CLIENT_SECRET: "fixture-secret",
      }),
    ).not.toHaveProperty("APPLE_CLIENT_ID");
  });

  it("rejects sender header injection", () => {
    expect(() =>
      productionAuthEnvironment({ ...base, ...smtp, AUTH_EMAIL_FROM: "a@example.com\r\nBcc: x" }),
    ).toThrow("Invalid email sender");
  });
});
