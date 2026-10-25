import { describe, it, expect } from "vitest";
import { configuration } from "./config";
const env = {
  AUTH_ORIGIN: "http://127.0.0.1:5174",
  APP_ENV: "local",
  BETTER_AUTH_SECRET: "a".repeat(32),
  AUTH_DATABASE_URL: "postgres://local",
  AUTH_INTERNAL_SECRET: "secret",
  COGNITO_CLIENT_ID: "client",
  COGNITO_CLIENT_SECRET: "secret",
  COGNITO_DOMAIN: "domain",
  COGNITO_REGION: "region",
  COGNITO_USERPOOL_ID: "pool",
};
describe("auth configuration", () => {
  it("permits explicit local fixtures without AWS", () =>
    expect(configuration(env).origin).toBe(env.AUTH_ORIGIN));
  it("rejects remote HTTP and missing secrets", () => {
    expect(() => configuration({ ...env, AUTH_ORIGIN: "http://example.com" })).toThrow();
    expect(() => configuration({ ...env, BETTER_AUTH_SECRET: undefined })).toThrow();
  });
  it("rejects paths and production HTTP", () => {
    expect(() => configuration({ ...env, AUTH_ORIGIN: "https://example.com/path" })).toThrow();
    expect(() => configuration({ ...env, APP_ENV: "production" })).toThrow();
  });
});

describe("password preview configuration", () => {
  const local = {
    ...env,
    AUTH_MODE: "password",
    COGNITO_CLIENT_ID: undefined,
    COGNITO_CLIENT_SECRET: undefined,
    COGNITO_DOMAIN: undefined,
    COGNITO_REGION: undefined,
    COGNITO_USERPOOL_ID: undefined,
  };
  it("permits local credentials without Cognito config", () =>
    expect(configuration(local).method).toBe("password"));
  it("rejects production and remote credential modes", () => {
    expect(() =>
      configuration({ ...local, APP_ENV: "production", AUTH_ORIGIN: "https://localhost" }),
    ).toThrow();
    expect(() => configuration({ ...local, AUTH_ORIGIN: "https://example.com" })).toThrow();
    expect(() => configuration({ ...local, AUTH_MODE: "other" })).toThrow();
  });
});

describe("passkey and social capabilities", () => {
  it("uses exact application origin for passkeys and defaults to available", () => {
    expect(configuration(env).passkey).toBe(false);
    expect(configuration({ ...env, AUTH_ORIGIN: "http://localhost:5174" }).passkey).toBe(true);
    expect(configuration({ ...env, AUTH_ORIGIN: "https://192.0.2.1" }).passkey).toBe(false);
    expect(configuration({ ...env, AUTH_ORIGIN: "https://[::1]" }).passkey).toBe(false);
    expect(configuration({ ...env, AUTH_ORIGIN: "https://quorem.example" }).passkey).toBe(true);
    expect(configuration({ ...env, AUTH_PASSKEYS: "false" }).passkey).toBe(false);
    expect(() => configuration({ ...env, AUTH_PASSKEYS: "yes" })).toThrow();
  });
  it("does not advertise unconfigured providers and rejects partial credentials", () => {
    expect(configuration(env).social).toEqual({
      google: undefined,
      apple: undefined,
      github: undefined,
    });
    expect(() => configuration({ ...env, GOOGLE_CLIENT_ID: "client" })).toThrow();
    expect(() => configuration({ ...env, APPLE_CLIENT_SECRET: "secret" })).toThrow();
    expect(
      configuration({ ...env, GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret" }).social
        .github,
    ).toEqual({ clientId: "client", clientSecret: "secret" });
  });
});

describe("local registration mail", () => {
  it("requires local credential mode and loopback SMTP", () => {
    expect(
      configuration({ ...env, AUTH_MODE: "password", SMTP_HOST: "127.0.0.1" }).registration,
    ).toBe(true);
    expect(configuration({ ...env, AUTH_MODE: "password" }).registration).toBe(false);
    expect(() => configuration({ ...env, SMTP_HOST: "127.0.0.1" })).toThrow();
    expect(() =>
      configuration({ ...env, AUTH_MODE: "password", SMTP_HOST: "smtp.example.com" }),
    ).toThrow();
    expect(() =>
      configuration({ ...env, AUTH_MODE: "password", SMTP_HOST: "localhost", SMTP_PORT: "0" }),
    ).toThrow();
  });
});

describe("independent platform capabilities", () => {
  const production = {
    ...env,
    APP_ENV: "production",
    AUTH_ORIGIN: "https://quorem.example",
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
    AUTH_EMAIL_DRIVER: "ses-smtp",
    AUTH_EMAIL_SES_REGION: "us-east-1",
    AUTH_EMAIL_FROM: "accounts@quorem.example",
    SMTP_USERNAME: "smtp-user",
    SMTP_PASSWORD: "smtp-secret",
  };
  it("permits explicit production credentials with secure SES delivery and no Cognito", () => {
    const result = configuration({ ...production, COGNITO_CLIENT_ID: undefined });
    expect(result.registration).toBe(true);
    expect(result.localPassword).toBe(false);
    expect(result.mail).toMatchObject({
      driver: "ses-smtp",
      host: "email-smtp.us-east-1.amazonaws.com",
      port: 465,
      secure: true,
      requireTLS: true,
    });
  });
  it("fails closed for production opt-in, transport and missing capabilities", () => {
    for (const override of [
      { AUTH_PASSWORD_PRODUCTION: undefined },
      { AUTH_EMAIL_DRIVER: "none" },
      { SMTP_PASSWORD: undefined },
      { SMTP_PORT: "25" },
      { AUTH_ORIGIN: "http://quorem.example" },
      { AUTH_EMAIL_FROM: undefined },
      { AUTH_PASSWORD_PRODUCTION: "yes" },
    ])
      expect(() => configuration({ ...production, ...override })).toThrow();
  });
  it("mixes R2 with SES or Cloudflare email with S3 independently", () => {
    expect(
      configuration({
        ...production,
        AVATAR_STORAGE_DRIVER: "r2",
        AVATAR_R2_ACCOUNT_ID: "a".repeat(32),
        AVATAR_R2_BUCKET: "avatars",
        AVATAR_R2_ACCESS_KEY_ID: "key",
        AVATAR_R2_SECRET_ACCESS_KEY: "secret",
      }).avatars,
    ).toMatchObject({ driver: "r2", bucket: "avatars" });
    expect(
      configuration({
        ...production,
        AUTH_EMAIL_DRIVER: "cloudflare",
        AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
        AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "token",
        AVATAR_S3_BUCKET: "avatars",
      }).mail,
    ).toMatchObject({ driver: "cloudflare" });
  });
  it("validates explicit storage and prevents insecure remote endpoints", () => {
    for (const override of [
      { AVATAR_STORAGE_DRIVER: "other" },
      { AVATAR_STORAGE_DRIVER: "r2", AVATAR_R2_BUCKET: "avatars" },
      { AVATAR_S3_BUCKET: "avatars", AVATAR_S3_ACCESS_KEY_ID: "key" },
      { AVATAR_S3_BUCKET: "avatars", AVATAR_S3_ENDPOINT: "http://remote.example" },
    ])
      expect(() => configuration({ ...production, ...override })).toThrow();
  });
});

describe("production login without SMTP", () => {
  const production = {
    ...env,
    APP_ENV: "production",
    AUTH_ORIGIN: "https://deployment.example",
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
    AUTH_LOGIN_ONLY: "true",
  };
  it("allows verified operator accounts while registration stays disabled", () => {
    const result = configuration(production);
    expect(result.registration).toBe(false);
    expect(result.mail).toBeUndefined();
    expect(result.social).toEqual({ google: undefined, apple: undefined, github: undefined });
  });
  it("rejects implicit opt-in, HTTP and conflicting mail configuration", () => {
    for (const override of [
      { AUTH_LOGIN_ONLY: undefined },
      { AUTH_LOGIN_ONLY: "yes" },
      { AUTH_PASSWORD_PRODUCTION: undefined },
      { AUTH_ORIGIN: "http://deployment.example" },
      { AUTH_MODE: "cognito" },
      { SMTP_HOST: "localhost" },
    ])
      expect(() => configuration({ ...production, ...override })).toThrow();
  });
});
