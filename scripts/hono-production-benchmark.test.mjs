import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkProductionPython } from "./hono-production-benchmark.mjs";

test("benchmarks exactly one public case per queue-backed run", async () => {
  let submissions = 0;
  const result = await benchmarkProductionPython(
    {
      AUTH_BOOTSTRAP_USERNAME: "fixture",
      AUTH_BOOTSTRAP_PASSWORD: "fixture",
    },
    async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/sign-in/username")
        return Response.json(
          {},
          { headers: { "set-cookie": "better-auth.session_token=fixture; Path=/" } },
        );
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
  );
  assert.equal(submissions, 5);
  assert.equal(result.samples.length, 5);
  assert.ok(result.p50Ms <= result.maxMs);
});
