import { expect, it, vi } from "vitest";
import { accessFetch } from "@quorem/execution/transport/access";
import { httpResultVerifier } from "../../adapters/postgres/judging/worker/verification-client.ts";
import { drainConfig, privateConfig } from "./config.ts";
import { validateDrainTransport } from "./wake-consumer.ts";
const base = {
  RUNNER_PEERS: JSON.stringify([
    { secret: "fixture-runner-secret-32-characters", scope: "scope", resumable: true },
  ]),
  VERIFICATION_SOURCE_CREDENTIAL: "11".repeat(32),
  VERIFICATION_SERVICE_CREDENTIAL: "22".repeat(32),
  VERIFICATION_ACCESS_MODE: "none",
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
it("requires explicit purpose-scoped verifier Access and rejects credential reuse", () => {
  const secure = {
    ...base,
    APP_ENV: "production",
    VERIFICATION_SERVICE_ORIGIN: "https://verify.example",
    VERIFICATION_ACCESS_MODE: "cloudflare-access",
    VERIFICATION_ACCESS_CLIENT_ID: "verify-id",
    VERIFICATION_ACCESS_CLIENT_SECRET: "verify-secret",
  };
  expect(privateConfig(secure).verificationAccess).toEqual({
    id: "verify-id",
    secret: "verify-secret",
  });
  expect(() =>
    privateConfig({ ...secure, VERIFICATION_ACCESS_CLIENT_SECRET: undefined }),
  ).toThrow();
  expect(() =>
    privateConfig({
      ...secure,
      VERIFICATION_ACCESS_CLIENT_SECRET: base.VERIFICATION_SOURCE_CREDENTIAL,
    }),
  ).toThrow();
  expect(() =>
    privateConfig({ ...secure, EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "verify-secret" }),
  ).toThrow();
  expect(() => privateConfig({ ...secure, VERIFICATION_ACCESS_MODE: "none" })).toThrow();
  expect(() => privateConfig({ ...secure, VERIFICATION_ACCESS_MODE: undefined })).toThrow();
});

it("sends verifier bearer and Access pair only to the pinned origin", async () => {
  const config = privateConfig({
    ...base,
    APP_ENV: "production",
    VERIFICATION_SERVICE_ORIGIN: "https://verify.example",
    VERIFICATION_ACCESS_MODE: "cloudflare-access",
    VERIFICATION_ACCESS_CLIENT_ID: "verify-id",
    VERIFICATION_ACCESS_CLIENT_SECRET: "verify-secret",
  });
  const send = vi.fn(async () => new Response(null, { status: 503 }));
  const fetch = accessFetch(config.verificationServiceOrigin, config.verificationAccess, send)!;
  const verifier = httpResultVerifier({
    origin: config.verificationServiceOrigin,
    credential: new Uint8Array(32),
    timeoutMs: 1000,
    fetch,
  });
  await expect(verifier.verify("fixture")).rejects.toThrow("Verifier unavailable");
  const [url, init] = send.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.origin).toBe("https://verify.example");
  expect(init.redirect).toBe("manual");
  expect(new Headers(init.headers).get("cf-access-client-id")).toBe("verify-id");
  expect(new Headers(init.headers).get("cf-access-client-secret")).toBe("verify-secret");
  expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${"00".repeat(32)}`);
  await expect(fetch("https://other.example/", {})).rejects.toThrow();
});

it("validates one purpose-scoped drain configuration for both runtimes", () => {
  const local = {
    ...base,
    APP_ENV: "local",
    EXECUTION_DRAIN_URL: "http://127.0.0.1:8787/internal/drain",
    EXECUTION_DRAIN_SECRET: "d".repeat(40),
    EXECUTION_DRAIN_ACCESS_MODE: "none",
  };
  expect(drainConfig(local)).toMatchObject({
    drainURL: local.EXECUTION_DRAIN_URL,
    credential: local.EXECUTION_DRAIN_SECRET,
    local: true,
    fetch: undefined,
  });
  expect(() =>
    drainConfig({
      ...local,
      APP_ENV: "production",
      VERIFICATION_SERVICE_ORIGIN: "https://verifier.example",
    }),
  ).toThrow();
  expect(() =>
    drainConfig({ ...local, EXECUTION_DRAIN_SECRET: base.VERIFICATION_SOURCE_CREDENTIAL }),
  ).toThrow();
  expect(() => drainConfig({ ...local, EXECUTION_DRAIN_SECRET: "short" })).toThrow();
  expect(() => drainConfig({ ...local, EXECUTION_DRAIN_ACCESS_CLIENT_ID: "unexpected" })).toThrow();
  const secure = {
    ...local,
    APP_ENV: "production",
    VERIFICATION_SERVICE_ORIGIN: "https://verifier.example",
    EXECUTION_DRAIN_URL: "https://drain.example/internal/drain",
    EXECUTION_DRAIN_ACCESS_MODE: "cloudflare-access",
    EXECUTION_DRAIN_ACCESS_CLIENT_ID: "access-id",
    EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "access-secret",
  };
  expect(drainConfig(secure).fetch).toBeTypeOf("function");
  expect(() =>
    drainConfig({ ...secure, EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: undefined }),
  ).toThrow();
  expect(() =>
    drainConfig({ ...secure, EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: secure.EXECUTION_DRAIN_SECRET }),
  ).toThrow();
  expect(() =>
    drainConfig({
      ...secure,
      EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: secure.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
    }),
  ).toThrow();
  expect(() =>
    drainConfig({ ...secure, EXECUTION_DRAIN_URL: "https://drain.example/other" }),
  ).toThrow();
  expect(() =>
    drainConfig({
      ...local,
      EXECUTION_DRAIN_ACCESS_MODE: "cloudflare-access",
      EXECUTION_DRAIN_ACCESS_CLIENT_ID: "id",
      EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "secret",
    }),
  ).toThrow();
});

it("shares strict endpoint and credential validation", () => {
  const secret = "s".repeat(32);
  expect(validateDrainTransport("http://[::1]:9000/internal/drain", secret, true).hostname).toBe(
    "[::1]",
  );
  for (const [url, credential, local] of [
    ["http://[::1]:9000/internal/drain", secret, false],
    ["https://user:pass@example.test/internal/drain", secret, false],
    ["https://example.test/internal/drain?x=1", secret, false],
    ["https://example.test/other", secret, false],
    ["https://example.test/internal/drain", "short", false],
    ["https://example.test/internal/drain", `${secret} `, false],
  ] as const)
    expect(() => validateDrainTransport(url, credential, local)).toThrow();
});
