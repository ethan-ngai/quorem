import { test } from "node:test";
import assert from "node:assert/strict";
import { hostedAcceptance } from "./hono-stage-deploy-acceptance.mjs";
const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const env = () => ({
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_STAGE_BROWSER_ORIGIN: "https://web-stage.example.com",
  ALLOWED_ORIGINS: "https://web-stage.example.com",
  HONO_DRAIN_ORIGIN: "https://drain-stage.example.com",
  HONO_STAGE_PROBLEM_VERSION_ID: uuid,
  HONO_STAGE_SESSION_COOKIE: "fixture=session",
  HONO_STAGE_ACCEPT_SOURCE: "fixture",
  HONO_STAGE_ACCEPTANCE_MODE: "manual",
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
  EXECUTION_DRAIN_ACCESS_CLIENT_ID: "fixture-id",
  EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "fixture-secret",
});
void test("exchanges session, uses bearer, creates workspace, admits and drains", async () => {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return Response.json({ token: "fixture.jwt.token" });
    if (calls.length === 2) return Response.json({ id: uuid }, { status: 201 });
    if (calls.length === 3) return Response.json({ id: uuid }, { status: 202 });
    if (calls.length === 4) return new Response(null, { status: 200 });
    return Response.json({ verdict: "accepted" });
  };
  assert.equal((await hostedAcceptance(env(), send)).submission, uuid);
  assert.equal(calls.length, 5);
  assert.match(calls[0].url, /\/api\/auth\/token$/);
  assert.equal(new Headers(calls[0].init.headers).get("origin"), env().HONO_STAGE_BROWSER_ORIGIN);
  for (const index of [1, 2, 4]) {
    const h = new Headers(calls[index].init.headers);
    assert.equal(h.get("authorization"), "Bearer fixture.jwt.token");
    assert.equal(h.get("cookie"), null);
  }
  assert.equal(new Headers(calls[3].init.headers).get("cf-access-client-id"), "fixture-id");
});
void test("queue mode never manually drains and polls until accepted", async () => {
  let calls = 0;
  const send = async (url) => {
    assert.doesNotMatch(String(url), /internal\/drain/);
    calls++;
    if (calls === 1) return Response.json({ token: "fixture.jwt.token" });
    if (calls === 2) return Response.json({ id: uuid }, { status: 201 });
    if (calls === 3) return Response.json({ id: uuid }, { status: 202 });
    return Response.json(calls === 4 ? { state: "running" } : { verdict: "accepted" });
  };
  assert.equal(
    (
      await hostedAcceptance(
        { ...env(), HONO_STAGE_ACCEPTANCE_MODE: "queue" },
        send,
        async () => {},
      )
    ).submission,
    uuid,
  );
  assert.equal(calls, 5);
});
void test("rejects unsafe origin, unauthorized token and oversized responses", async () => {
  await assert.rejects(
    hostedAcceptance({ ...env(), ALLOWED_ORIGINS: "https://other-stage.example.com" }, async () => {
      throw new Error("must not call");
    }),
  );
  await assert.rejects(
    hostedAcceptance({ ...env(), HONO_STAGE_API_ORIGIN: "https://prod.example.com" }, async () => {
      throw new Error("must not call");
    }),
  );
  await assert.rejects(
    hostedAcceptance(env(), async () => new Response(null, { status: 401 })),
    /token exchange/,
  );
  await assert.rejects(
    hostedAcceptance(env(), async () => new Response("a".repeat(65537), { status: 200 })),
    /Oversized/,
  );
});
