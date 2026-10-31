import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPrivateIngress } from "./hono-stage-deploy-ingress.mjs";
const env = () => ({
  QUOREM_CASE_ORIGIN: "https://case-stage.example.com",
  VERIFICATION_SERVICE_ORIGIN: "https://verify-stage.example.com",
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_DRAIN_ORIGIN: "https://drain-stage.example.com",
  QUOREM_CASE_SECRET: "c".repeat(32),
  VERIFICATION_SERVICE_CREDENTIAL: "a".repeat(64),
  VERIFICATION_SOURCE_CREDENTIAL: "b".repeat(64),
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
  VERIFICATION_ACCESS_CLIENT_ID: "v-id",
  VERIFICATION_ACCESS_CLIENT_SECRET: "v-secret",
  CLOUDFLARE_ACCESS_CLIENT_ID: "a-id",
  CLOUDFLARE_ACCESS_CLIENT_SECRET: "a-secret",
  EXECUTION_DRAIN_ACCESS_CLIENT_ID: "d-id",
  EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "d-secret",
});
void test("uses valid controls before rejecting identical bearer requests without Access", async () => {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url: String(url), init });
    const n = calls.length;
    return new Response(null, { status: n === 2 || n === 4 ? 503 : n === 6 ? 200 : 403 });
  };
  await verifyPrivateIngress(env(), "a".repeat(64), send, async () => ({
    namespace: "a".repeat(64),
  }));
  assert.equal(calls.length, 7);
  for (const [control, negative] of [
    [1, 2],
    [3, 4],
    [5, 6],
  ]) {
    const a = new Headers(calls[control].init.headers),
      b = new Headers(calls[negative].init.headers);
    assert.equal(a.get("authorization"), b.get("authorization"));
    assert.ok(a.get("cf-access-client-id"));
    assert.equal(b.get("cf-access-client-id"), null);
    assert.equal(calls[control].url, calls[negative].url);
  }
});
void test("rejects unexpected control responses, missing Access and namespace drift", async () => {
  await assert.rejects(
    verifyPrivateIngress(
      env(),
      "a".repeat(64),
      async () => new Response(null, { status: 200 }),
      async () => ({ namespace: "a".repeat(64) }),
    ),
  );
  await assert.rejects(
    verifyPrivateIngress(
      env(),
      "a".repeat(64),
      async () => {
        throw new Error("must not call");
      },
      async () => ({ namespace: "b".repeat(64) }),
    ),
    /changed/,
  );
});
