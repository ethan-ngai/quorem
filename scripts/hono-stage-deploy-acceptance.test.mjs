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
  assert.equal(new Headers(calls[3].init.headers).get("cf-access-client-id"), null);
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

void test("manual acceptance follows 202 continuations and requires the accepted result", async () => {
  let drains = 0,
    polls = 0,
    delays = 0;
  const send = async (url) => {
    if (url.endsWith("/api/auth/token")) return Response.json({ token: "fixture.jwt" });
    if (url.endsWith("/v1/workspaces")) return Response.json({ id: uuid }, { status: 201 });
    if (url.endsWith("/v1/submissions")) return Response.json({ id: uuid }, { status: 202 });
    if (url.endsWith("/internal/drain"))
      return new Response(null, { status: ++drains === 1 ? 202 : 200 });
    polls++;
    return Response.json({ verdict: polls === 1 ? null : "accepted" });
  };
  assert.equal(
    (
      await hostedAcceptance(env(), send, async () => {
        delays++;
      })
    ).submission,
    uuid,
  );
  assert.equal(drains, 2);
  assert.equal(polls, 2);
  assert.equal(delays, 1);
});

void test("manual drain exposes only bounded readiness diagnostic fields", async () => {
  const send = async (url) => {
    if (url.endsWith("/api/auth/token")) return Response.json({ token: "fixture.jwt" });
    if (url.endsWith("/v1/workspaces")) return Response.json({ id: uuid }, { status: 201 });
    if (url.endsWith("/v1/submissions")) return Response.json({ id: uuid }, { status: 202 });
    return Response.json(
      {
        error: "container-readiness",
        port: 8090,
        probes: 5,
        status: 0,
        failure: "refused",
        running: true,
        private: "fixture-secret",
      },
      { status: 503 },
    );
  };
  await assert.rejects(hostedAcceptance(env(), send), (error) => {
    assert.equal(error.status, 503);
    assert.deepEqual(error.diagnostic, {
      port: 8090,
      probes: 5,
      status: 0,
      failure: "refused",
      running: true,
    });
    assert.equal(JSON.stringify(error).includes("fixture-secret"), false);
    return true;
  });
});

void test("expired bearer refreshes through the fixture session without readmitting work", async () => {
  let tokens = 0,
    admissions = 0,
    polls = 0;
  const send = async (url, init) => {
    if (url.endsWith("/api/auth/token")) return Response.json({ token: `fixture.${++tokens}` });
    if (url.endsWith("/v1/workspaces")) return Response.json({ id: uuid }, { status: 201 });
    if (url.endsWith("/v1/submissions")) {
      admissions++;
      return Response.json({ id: uuid }, { status: 202 });
    }
    if (url.endsWith("/internal/drain")) return new Response(null, { status: 202 });
    if (++polls === 1) return new Response(null, { status: 401 });
    assert.equal(init.headers.authorization, "Bearer fixture.2");
    return Response.json({ verdict: "accepted" });
  };
  assert.equal((await hostedAcceptance(env(), send)).submission, uuid);
  assert.equal(tokens, 2);
  assert.equal(admissions, 1);
});
