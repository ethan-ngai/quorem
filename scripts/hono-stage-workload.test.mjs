import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runStageWorkload } from "./hono-stage-workload.mjs";
const room = "11111111-1111-4111-8111-111111111111",
  workspace = "33333333-3333-4333-8333-333333333333",
  receipt = "44444444-4444-4444-8444-444444444444";
const env = {
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_STAGE_BROWSER_ORIGIN: "https://web-stage.example.com",
  ALLOWED_ORIGINS: "https://web-stage.example.com",
  QUOREM_STAGE_DATABASE_URL: "redacted",
  BETTER_AUTH_SECRET: "fixture",
};
function fixture({
  failAdmission = false,
  badToken = false,
  badFrame = false,
  lostNotice = false,
} = {}) {
  let requests = 0,
    clock = 1000,
    actors = 0,
    disposed = 0,
    admissions = [],
    messages = [],
    closed = 0,
    lost = false,
    resultReads = 0,
    resultTimes = [];
  class Socket extends EventEmitter {
    readyState = 0;
    constructor(url, protocols, options) {
      super();
      assert.match(url, /^wss:/);
      assert.equal(protocols[0], "quorem");
      assert.equal(options.origin, env.HONO_STAGE_BROWSER_ORIGIN);
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open");
        if (lostNotice && url.includes("/submissions/") && !lost) {
          lost = true;
          setImmediate(() => this.close());
        }
        queueMicrotask(() =>
          this.emit(
            "message",
            Buffer.from(
              JSON.stringify(
                badFrame ? { receipt: "bad" } : { receipt, payload: { type: "heartbeat" } },
              ),
            ),
            false,
          ),
        );
      });
    }
    send(value) {
      messages.push(JSON.parse(value));
    }
    terminate() {
      this.close();
    }
    close() {
      this.readyState = 3;
      closed++;
      this.emit("close");
    }
  }
  const deps = {
    matchCount: 1,
    WebSocket: Socket,
    now: () => clock,
    delay: async (ms) => {
      await new Promise((resolve) => setImmediate(resolve));
      clock += ms;
    },
    createActor: async () => {
      actors++;
      return {
        sessionCookie: `cookie-${actors}`,
        acceptedSource: "test",
        problemVersionId: workspace,
        dispose: async () => {
          disposed++;
        },
      };
    },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/token")
        return Response.json({ token: badToken ? "bad token" : `fixture-token-${++requests}` });
      if (path === "/v1/matches")
        return Response.json({ id: room, inviteUrl: "/invite/example" }, { status: 201 });
      if (path === `/v1/matches/${room}`)
        return Response.json({
          participants: [
            { workspaceId: `33333333-3333-4333-8333-${String(++requests).padStart(12, "0")}` },
          ],
        });
      if (path.endsWith("/ready")) return Response.json({ state: "active" });
      if (path === "/v1/submissions") {
        admissions.push({ at: clock, body: JSON.parse(init.body) });
        return failAdmission
          ? new Response(null, { status: 503 })
          : Response.json(
              { id: `22222222-2222-4222-8222-${String(++requests).padStart(12, "0")}` },
              { status: 202 },
            );
      }
      if (path.startsWith("/v1/submissions/")) {
        resultReads++;
        resultTimes.push(clock);
        return Response.json(
          lostNotice && resultReads === 1 ? { state: "running" } : { verdict: "accepted" },
        );
      }
      return Response.json({});
    },
  };
  return {
    deps,
    state: () => ({ actors, disposed, admissions, messages, closed, resultReads, resultTimes }),
  };
}
void test("drives public match, receipt acknowledgements, paced runs and cleanup", async () => {
  const f = fixture(),
    result = await runStageWorkload(env, f.deps),
    state = f.state();
  assert.equal(result.profile, "fixture");
  assert.equal(result.sessions, 2);
  assert.equal(result.admissions, 2);
  assert.equal(state.admissions[1].at - state.admissions[0].at, 500);
  assert.ok(state.resultTimes[0] < state.admissions[1].at);
  assert.equal(result.jobs.p95Ms, 0);
  assert.ok(state.admissions.every(({ body }) => body.kind === "run"));
  assert.deepEqual(state.messages[0], { type: "receipt", id: receipt });
  assert.equal(state.disposed, 2);
  assert.equal(state.closed, 4);
});
void test("partial admission failure still closes sockets and revokes sessions", async () => {
  const f = fixture({ failAdmission: true });
  await assert.rejects(runStageWorkload(env, f.deps));
  assert.equal(f.state().disposed, 2);
  assert.equal(f.state().closed, 2);
});

void test("rejects whitespace tokens and malformed socket frames", async () => {
  for (const options of [{ badToken: true }, { badFrame: true }]) {
    const f = fixture(options);
    await assert.rejects(runStageWorkload(env, f.deps));
    assert.equal(f.state().disposed, f.state().actors);
  }
});

void test("lost result notice reconnects and refreshes snapshot without polling", async () => {
  const f = fixture({ lostNotice: true });
  const result = await runStageWorkload(env, f.deps);
  assert.equal(result.jobs.count, 2);
  assert.equal(result.reconnects, 1);
  assert.equal(f.state().resultReads, 3);
});
