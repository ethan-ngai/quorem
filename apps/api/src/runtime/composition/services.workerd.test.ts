import { expect, it } from "vitest";
import worker from "../../../../../deploy/hono/services/worker.js";
const secret = (value: string) => value.repeat(64);
it("enforces scoped hosts and attests large valid case ordinals in workerd", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  let forwarded: Request | undefined;
  const env = {
    DRAIN_ORIGIN: "https://runner-stage.example.test",
    VERIFIER_ORIGIN: "https://verify-stage.example.test",
    CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
    QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
    QUOREM_CASE_SECRET: secret("c"),
    QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
    QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
    RUNNER_API_ACCESS_CLIENT_ID: "runner-id",
    RUNNER_API_ACCESS_CLIENT_SECRET: secret("f"),
    VERIFIER_API_ACCESS_CLIENT_ID: "verifier-id",
    VERIFIER_API_ACCESS_CLIENT_SECRET: secret("g"),
    QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
    QUOREM_CASE_ACCESS_CLIENT_SECRET: secret("h"),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: "public key",
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "private key",
    CASE_OWNER_PRIVATE_KEY: btoa(String.fromCharCode(...pkcs8)),
    CASES: {
      idFromName: () => secret("1"),
      getByName: () => ({
        fetch: async (request: Request) => {
          forwarded = request;
          return new Response("ok");
        },
      }),
    },
  };
  const body = "case bytes",
    bytes = new TextEncoder().encode(body);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const nonce = crypto.randomUUID();
  const request = new Request(`${env.CASE_ORIGIN}/internal/case/attempt-1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
      "cf-access-client-secret": "must-strip",
      "x-quorem-owner-nonce": nonce,
      "x-quorem-owner-scope": `remote:${secret("0")}`,
      "x-quorem-case-binding": secret("1"),
      "x-quorem-body-sha256": digest,
      "x-quorem-case-ordinal": "400",
    },
    body,
  });
  const response = await worker.fetch(request, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-quorem-owner-signature")).toBeTruthy();
  const signature = Uint8Array.from(atob(response.headers.get("x-quorem-owner-signature")!), (c) =>
    c.charCodeAt(0),
  );
  const attested = JSON.stringify([
    `remote:${secret("0")}`,
    secret("1"),
    "POST",
    "attempt-1",
    "",
    200,
    nonce,
    secret("1"),
    digest,
    "400",
    "",
    "",
    "",
  ]);
  expect(
    await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      signature,
      new TextEncoder().encode(attested),
    ),
  ).toBe(true);
  expect(forwarded?.headers.get("authorization")).toBeNull();
  expect(forwarded?.headers.get("cf-access-client-secret")).toBeNull();
  expect(
    (
      await worker.fetch(
        new Request("https://alternate.example.test/internal/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
        }),
        env,
      )
    ).status,
  ).toBe(404);
});
