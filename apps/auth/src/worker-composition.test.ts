import { describe, expect, it } from "vitest";
import { workerRuntime } from "./worker.ts";

const fixture = {
  DB: { connectionString: "postgres://localhost/fixture" },
  APP_ENV: "local",
  AUTH_MODE: "password",
  AUTH_ORIGIN: "http://localhost:58738",
  AUTH_INTERNAL_SECRET: "fixture",
  BETTER_AUTH_SECRET: "fixture-secret-".repeat(4),
  AUTH_EMAIL_DRIVER: "cloudflare",
  AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
  AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "fixture",
  AUTH_EMAIL_FROM: "fixture@example.test",
};
describe("Worker auth composition", () => {
  it("requires a distinct Access pair and HTTPS when stage media is selected", () => {
    const stage = {
      ...fixture,
      APP_ENV: "stage",
      AUTH_ORIGIN: "https://auth.example",
      AUTH_PASSWORD_PRODUCTION: "true",
      AUTH_MAIL_INTENT_KEY: "07".repeat(32),
      PROFILE_MEDIA_ENABLED: "true",
      PROFILE_IMAGE_SERVICE_URL: "https://image.example/",
      PROFILE_IMAGE_SERVICE_TOKEN: "image-fixture-token-".repeat(3),
      PROFILE_BUCKET: { get: async () => null, put: async () => {}, delete: async () => {} },
    };
    expect(() => workerRuntime(stage)).toThrow("Invalid image ingress configuration");
    const access = {
      ...stage,
      PROFILE_IMAGE_ACCESS_MODE: "cloudflare-access",
      PROFILE_IMAGE_ACCESS_CLIENT_ID: "fixture-id",
      PROFILE_IMAGE_ACCESS_CLIENT_SECRET: "fixture-secret",
    };
    expect(() => workerRuntime(access)).not.toThrow();
    expect(() =>
      workerRuntime({ ...access, PROFILE_IMAGE_SERVICE_URL: "http://image.example/" }),
    ).toThrow();
    expect(() =>
      workerRuntime({
        ...access,
        PROFILE_IMAGE_ACCESS_CLIENT_SECRET: stage.PROFILE_IMAGE_SERVICE_TOKEN,
      }),
    ).toThrow();
    expect(() => workerRuntime({ ...access, PROFILE_IMAGE_ACCESS_MODE: "none" })).toThrow();
  });
  it("fails closed for a missing or malformed selected mail key", () => {
    expect(() => workerRuntime(fixture)).toThrow(
      "AUTH_MAIL_INTENT_KEY must be 32 bytes encoded as hex",
    );
    expect(() => workerRuntime({ ...fixture, AUTH_MAIL_INTENT_KEY: "wrong" })).toThrow(
      "AUTH_MAIL_INTENT_KEY must be 32 bytes encoded as hex",
    );
  });
  it("does not expose the private session authority or enable profile uploads", async () => {
    const runtime = workerRuntime({ ...fixture, AUTH_MAIL_INTENT_KEY: "07".repeat(32) });
    expect(
      (await runtime.app.request("http://localhost:58738/internal/session/example")).status,
    ).toBe(404);
    expect(
      (
        await runtime.app.request("http://localhost:58738/api/auth/profile-photo", {
          method: "PUT",
          headers: { origin: "http://localhost:58738" },
        })
      ).status,
    ).toBe(401);
    const config = await (
      await runtime.app.request("http://localhost:58738/api/auth/quorem-config")
    ).json();
    expect(JSON.stringify(config)).not.toContain("07070707");
    expect(JSON.stringify(config)).not.toContain("fixture-secret");
  });
});
