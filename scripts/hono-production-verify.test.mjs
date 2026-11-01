import { test } from "node:test";
import assert from "node:assert/strict";
import { captureProductionSession, verifyProduction } from "./hono-production-verify.mjs";
import { hostedAcceptance } from "./hono-stage-deploy-acceptance.mjs";

const cookie = "__Secure-better-auth.session_token=old-session";
const env = {
  AUTH_BOOTSTRAP_USERNAME: "fixture-user",
  AUTH_BOOTSTRAP_PASSWORD: "fixture-password",
  EXECUTION_DRAIN_SECRET: "x".repeat(32),
};
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture({ expired = false, privateStatus = 401, badScore = false } = {}) {
  const calls = [];
  const send = async (url, init = {}) => {
    calls.push({ url, init });
    assert.match(url, /^https:\/\/(?:quorem\.app|runner-hono\.quorem\.app)\//);
    if (url.endsWith("/api/auth/sign-in/username")) {
      assert.deepEqual(JSON.parse(init.body), {
        username: env.AUTH_BOOTSTRAP_USERNAME,
        password: env.AUTH_BOOTSTRAP_PASSWORD,
      });
      return new Response(null, {
        headers: { "set-cookie": `${cookie}; Path=/; HttpOnly; Secure` },
      });
    }
    if (url.endsWith("/api/auth/quorem-config"))
      return Response.json({
        method: "password",
        passkey: true,
        registration: true,
        providers: ["google", "github"],
      });
    if (url.endsWith("/v1/problems")) return Response.json({ items: [] });
    if (url.includes("/internal/")) return new Response(null, { status: privateStatus });
    if (url.endsWith("/api/auth/token")) {
      assert.equal(init.headers.cookie, cookie);
      return expired
        ? new Response(null, { status: 401 })
        : Response.json({ token: "old-session.jwt" });
    }
    if (url.endsWith("/v1/workspaces")) return Response.json({ id: uuid }, { status: 201 });
    if (url.endsWith("/v1/submissions")) return Response.json({ id: uuid }, { status: 202 });
    if (url.endsWith(`/v1/submissions/${uuid}`))
      return Response.json({
        verdict: "accepted",
        score: { passed: 20, total: badScore ? 19 : 20 },
        publicCases: Array(3).fill({}),
        hiddenCases: Array(20).fill({}),
      });
    throw new Error("Unexpected endpoint");
  };
  return { send, calls };
}
void test("retains the original cookie and proves automatic 23-case acceptance", async () => {
  const { send, calls } = fixture();
  const captured = await captureProductionSession(env, send);
  assert.equal(captured, cookie);
  assert.equal((await verifyProduction(env, captured, send, async () => {})).submission, uuid);
  assert.equal(calls.filter((c) => c.url.endsWith("/internal/drain")).length, 2);
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/submissions")).length, 1);
  assert.equal(
    calls.find((c) => c.url.endsWith("/v1/workspaces")).init.headers.authorization,
    "Bearer old-session.jwt",
  );
});
void test("fails closed on expired original cookie, wrong case coverage and private exposure", async () => {
  await assert.rejects(
    verifyProduction(env, cookie, fixture({ expired: true }).send),
    /token exchange/,
  );
  await assert.rejects(
    verifyProduction(env, cookie, fixture({ badScore: true }).send),
    /case coverage/,
  );
  await assert.rejects(
    verifyProduction(env, cookie, fixture({ privateStatus: 200 }).send),
    /did not deny/,
  );
  await assert.rejects(
    verifyProduction(env, "wrong=session", fixture().send),
    /Invalid production session/,
  );
});
void test("sign-in refuses missing or duplicate session cookies without exposing response", async () => {
  await assert.rejects(
    captureProductionSession(env, async () => new Response(null)),
    /cookie/,
  );
  await assert.rejects(
    captureProductionSession(env, async () => new Response(null, { status: 401 })),
    /sign-in/,
  );
  const duplicate = new Headers();
  duplicate.append("set-cookie", "better-auth.session_token=one; Path=/");
  duplicate.append("set-cookie", "__Secure-better-auth.session_token=two; Path=/");
  await assert.rejects(
    captureProductionSession(env, async () => new Response(null, { headers: duplicate })),
    /cookie/,
  );
});
void test("stage acceptance retains its strict stage-only origin default", async () => {
  await assert.rejects(
    hostedAcceptance(
      {
        HONO_STAGE_API_ORIGIN: "https://quorem.app",
        HONO_DRAIN_ORIGIN: "https://runner-hono.quorem.app",
        HONO_STAGE_BROWSER_ORIGIN: "https://quorem.app",
      },
      async () => {
        throw new Error("unexpected request");
      },
    ),
    /staged origin/,
  );
});
