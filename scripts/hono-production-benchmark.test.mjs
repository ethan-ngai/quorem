import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkProductionPython } from "./hono-production-benchmark.mjs";

void test("benchmarks exactly one public case per queue-backed run", async () => {
  let submissions = 0,
    disposed = false;
  const result = await benchmarkProductionPython(
    {
      DATABASE_URL: "fixture-db",
      BETTER_AUTH_SECRET: "fixture-secret",
    },
    async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/token") return Response.json({ token: "fixture" });
      if (path === "/v1/workspaces") return Response.json({ id: "fixture" }, { status: 201 });
      if (path === "/v1/submissions") {
        const command = JSON.parse(init.body);
        assert.equal(command.kind, "run");
        assert.deepEqual(command.customCases, [{ args: [[1, 1, 2]], expected: [2, 1] }]);
        assert.ok(init.headers["idempotency-key"]);
        return Response.json({ id: String(++submissions) }, { status: 202 });
      }
      assert.match(path, /^\/v1\/submissions\/\d+$/);
      return Response.json({ verdict: "accepted", publicCases: [{ status: "passed" }] });
    },
    async () => {},
    async (authority) => {
      assert.deepEqual(authority, {
        databaseURL: "fixture-db",
        authSecret: "fixture-secret",
        count: 1,
      });
      return {
        actors: [{ cookie: "fixture-cookie" }],
        dispose: async () => {
          disposed = true;
        },
      };
    },
  );
  assert.equal(disposed, true);
  assert.equal(submissions, 5);
  assert.equal(result.samples.length, 5);
  assert.ok(result.p50Ms <= result.maxMs);
});

void test("revokes the temporary smoke actor when authentication fails", async () => {
  let disposed = false;
  await assert.rejects(
    benchmarkProductionPython(
      {},
      async () => new Response(null, { status: 429 }),
      async () => {},
      async () => ({
        actors: [{ cookie: "fixture-cookie" }],
        dispose: async () => {
          disposed = true;
        },
      }),
    ),
    { status: 429 },
  );
  assert.equal(disposed, true);
});
