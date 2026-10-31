import { expect, it } from "vitest";
import { privateConfig } from "./config.ts";
const base = {
  RUNNER_PEERS: JSON.stringify([
    { secret: "fixture-runner-secret-32-characters", scope: "scope", resumable: true },
  ]),
  VERIFICATION_SOURCE_CREDENTIAL: "11".repeat(32),
  VERIFICATION_SERVICE_CREDENTIAL: "22".repeat(32),
  VERIFICATION_SERVICE_ORIGIN: "http://127.0.0.1:9000",
  VERIFICATION_PUBLIC_KEY: "fixture",
};
it("only permits HTTP verifier origins in explicit local mode", () => {
  expect(() => privateConfig({ ...base, APP_ENV: "local" })).not.toThrow();
  expect(() => privateConfig({ ...base, APP_ENV: "production" })).toThrow();
  expect(() =>
    privateConfig({
      ...base,
      APP_ENV: "local",
      VERIFICATION_SERVICE_ORIGIN: "http://example.test",
    }),
  ).toThrow();
  expect(() =>
    privateConfig({
      ...base,
      APP_ENV: "production",
      VERIFICATION_SERVICE_ORIGIN: "https://verifier.example",
    }),
  ).not.toThrow();
});
