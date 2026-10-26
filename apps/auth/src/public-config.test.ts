import { describe, expect, it } from "vitest";
import { productionAuthConfiguration, productionAuthEnvironment } from "./production-config";
import { publicAuthConfiguration } from "./public-config";

describe("edge auth configuration", () => {
  it("projects the actual validated runtime without exposing credentials", () => {
    const env = {
      AUTH_ORIGIN: "https://quorem.test",
      BETTER_AUTH_SECRET: "secret".repeat(8),
      AUTH_INTERNAL_SECRET: "internal-secret",
      AUTH_GOOGLE_CLIENT_ID: "private-client-id",
      AUTH_GOOGLE_CLIENT_SECRET: "private-client-secret",
      SMTP_USERNAME: "accounts@quorem.test",
      SMTP_PASSWORD: "private-smtp-password",
      AUTH_EMAIL_FROM: "Quorem <accounts@quorem.test>",
    };
    const runtime = productionAuthEnvironment(env);
    expect(publicAuthConfiguration(productionAuthConfiguration(env, runtime))).toEqual({
      method: "password",
      preferredOrigin: env.AUTH_ORIGIN,
      passkey: true,
      registration: true,
      providers: ["google"],
    });
    const loginOnly = {
      ...env,
      SMTP_USERNAME: undefined,
      SMTP_PASSWORD: undefined,
      AUTH_EMAIL_FROM: undefined,
    };
    expect(
      publicAuthConfiguration(
        productionAuthConfiguration(loginOnly, productionAuthEnvironment(loginOnly)),
      ).registration,
    ).toBe(false);
  });
});
