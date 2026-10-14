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
