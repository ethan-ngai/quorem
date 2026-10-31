import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHostedProfile } from "./hono-stage-deploy-profile.mjs";
const env = {
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_STAGE_SESSION_COOKIE: "fixture=session",
};
void test("uploads, reads and deletes stage profile using same-origin session", async () => {
  const calls = [];
  await verifyHostedProfile(env, async (url, init = {}) => {
    calls.push({ url, init });
    if (calls.length === 1)
      return Response.json({
        image: "/api/auth/profile-photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      });
    if (calls.length === 2)
      return new Response("fixture", { headers: { "content-type": "image/webp" } });
    return Response.json({ image: null });
  });
  assert.deepEqual(
    calls.map((call) => call.init.method ?? "GET"),
    ["PUT", "GET", "DELETE"],
  );
  assert.equal(new Headers(calls[0].init.headers).get("origin"), env.HONO_STAGE_API_ORIGIN);
});
void test("failure after upload still deletes and rejects", async () => {
  let calls = 0;
  await assert.rejects(
    verifyHostedProfile(env, async () => {
      calls++;
      if (calls === 1)
        return Response.json({
          image: "/api/auth/profile-photos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        });
      if (calls === 2) return new Response(null, { status: 503 });
      return Response.json({ image: null });
    }),
  );
  assert.equal(calls, 3);
});
