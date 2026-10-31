import { test } from "node:test";
import assert from "node:assert/strict";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  TF_STATE_BUCKET: "quorem-state",
  CLOUDFLARE_API_TOKEN: "fixture-token-0123456789",
};
const good = (suffix) =>
  suffix === "managed"
    ? { bucketId: "a".repeat(32), domain: "fixture.r2.dev", enabled: false }
    : { domains: [] };
const response = (suffix, patch = {}) =>
  Response.json({ success: true, errors: [], result: { ...good(suffix), ...patch } });
void test("checks both authenticated Cloudflare domain endpoints", async () => {
  const seen = [];
  const result = await requirePrivateStageState(env, async (url, options) => {
    seen.push(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    return response(url.split("/").at(-1));
  });
  assert.deepEqual(
    seen.map((v) => v.split("/").at(-1)),
    ["managed", "custom"],
  );
  assert.equal(result.managedPublic, false);
  const disabled = await requirePrivateStageState(env, async (url) => {
    const suffix = url.split("/").at(-1);
    return response(
      suffix,
      suffix === "custom" ? { domains: [{ domain: "private.example.com", enabled: false }] } : {},
    );
  });
  assert.equal(disabled.customDomains, 1);
});
void test("rejects public, malformed, oversized and inaccessible domain responses without secrets", async () => {
  for (const [path, patch] of [
    ["managed", { enabled: true }],
    ["managed", { enabled: null }],
    ["managed", { bucketId: null }],
    ["custom", { domains: [{ domain: "x.test", enabled: true }] }],
    ["custom", { domains: [{ domain: "x.test" }] }],
    ["custom", { domains: null }],
    [
      "custom",
      {
        domains: [
          { domain: "x.test", enabled: false },
          { domain: "x.test", enabled: false },
        ],
      },
    ],
  ]) {
    await assert.rejects(
      requirePrivateStageState(env, async (url) => {
        const suffix = url.split("/").at(-1);
        return response(suffix, suffix === path ? patch : {});
      }),
      /could not be verified/,
    );
  }
  for (const answer of [
    () => new Response(null, { status: 403 }),
    () => Response.json({ success: false }),
    () => new Response("x".repeat(65537)),
  ])
    await assert.rejects(
      requirePrivateStageState(env, async () => answer()),
      (error) => !String(error).includes(env.CLOUDFLARE_API_TOKEN),
    );
  await assert.rejects(
    requirePrivateStageState({ ...env, TF_STATE_BUCKET: "../bad" }, async () => {
      throw new Error("unexpected");
    }),
    /Invalid/,
  );
});
