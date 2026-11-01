import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyNoAlternateIngress } from "./hono-stage-deploy-subdomains.mjs";
const env = () => ({
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture-token",
  TF_VAR_worker_name: "quorem-hono-stage",
  HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
});
void test("verifies both stage Workers have disabled subdomains and previews", async () => {
  const calls = [];
  await verifyNoAlternateIngress(env(), async (url, init) => {
    calls.push([url, init]);
    return Response.json({ success: true, result: { enabled: false, previews_enabled: false } });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].redirect, "error");
});
void test("fails closed on enabled, missing, oversized or inaccessible settings", async () => {
  for (const response of [
    Response.json({ success: true, result: { enabled: true, previews_enabled: false } }),
    Response.json({ success: true, result: { enabled: false } }),
    new Response("x".repeat(16385)),
    new Response(null, { status: 403 }),
  ])
    await assert.rejects(verifyNoAlternateIngress(env(), async () => response));
});
