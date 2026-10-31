import { test } from "node:test";
import assert from "node:assert/strict";
import { hostedAcceptance } from "./hono-stage-deploy-acceptance.mjs";
const env = () => ({
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_DRAIN_ORIGIN: "https://drain-stage.example.com",
  HONO_STAGE_WORKSPACE_ID: "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12),
  HONO_STAGE_SESSION_COOKIE: "fixture=session",
  HONO_STAGE_ACCEPT_SOURCE: "fixture",
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
  EXECUTION_DRAIN_ACCESS_CLIENT_ID: "fixture-id",
  EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "fixture-secret",
});
void test("requires hosted admission, private drain and accepted result", async () => {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1)
      return Response.json({ id: env().HONO_STAGE_WORKSPACE_ID }, { status: 202 });
    if (calls.length === 2) return new Response(null, { status: 200 });
    return Response.json({ verdict: "accepted" });
  };
  assert.equal((await hostedAcceptance(env(), send)).submission, env().HONO_STAGE_WORKSPACE_ID);
  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[1].init.headers).get("cf-access-client-id"), "fixture-id");
});
void test("fails closed for incorrect origins or unaccepted results", async () => {
  await assert.rejects(
    hostedAcceptance({ ...env(), HONO_STAGE_API_ORIGIN: "https://prod.example.com" }, async () => {
      throw new Error("must not call");
    }),
  );
  let count = 0;
  await assert.rejects(
    hostedAcceptance(env(), async () =>
      ++count === 1
        ? Response.json({ id: env().HONO_STAGE_WORKSPACE_ID }, { status: 202 })
        : count === 2
          ? new Response(null, { status: 200 })
          : Response.json({ verdict: "wrong_answer" }),
    ),
    /not accepted/,
  );
});

void test("rejects private drain failure and oversized admission body", async () => {
  let calls = 0;
  await assert.rejects(
    hostedAcceptance(env(), async () =>
      ++calls === 1
        ? Response.json({ id: env().HONO_STAGE_WORKSPACE_ID }, { status: 202 })
        : new Response(null, { status: 403 }),
    ),
    /drain failed/,
  );
  await assert.rejects(
    hostedAcceptance(env(), async () => new Response("a".repeat(65537), { status: 202 })),
    /Oversized/,
  );
});
