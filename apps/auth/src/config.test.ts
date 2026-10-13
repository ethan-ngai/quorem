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
