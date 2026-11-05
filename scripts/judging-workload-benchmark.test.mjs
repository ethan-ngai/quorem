import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkJudgingWorkload } from "./judging-workload-benchmark.mjs";

void test("eight distinct actors submit twenty cases concurrently and observe completion through SSE", async () => {
  let admitted = 0,
    opened = 0;
  const actors = Array.from({ length: 8 }, (_, id) => ({
    id: String(id),
    workspaceId: `w${id}`,
    headers: { authorization: `Bearer fixture-${id}` },
  }));
  const cases = Array.from({ length: 20 }, () => ({ args: [], expected: 7 }));
  const result = await benchmarkJudgingWorkload(
    { origin: "https://fixture.test", actors, cases, source: "fixture" },
    async (url, init) => {
      const path = new URL(url).pathname;
      const actor = init.headers.authorization.split("-").at(-1);
      if (path === "/v1/submissions") {
        assert.equal(JSON.parse(init.body).customCases.length, 20);
        admitted++;
        return Response.json({ id: actor }, { status: 202 });
      }
      if (path.endsWith("/events")) {
        opened++;
        assert.equal(admitted, 8);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: changed\ndata: {}\n\n"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return Response.json({
        verdict: "accepted",
        publicCases: cases.map(() => ({ status: "accepted" })),
      });
    },
  );
  assert.equal(opened, 8);
  assert.equal(result.samples.length, 8);
  assert.equal(result.meetsTarget, true);
});

void test("failed admissions retain bounded phase metrics instead of losing the workload report", async () => {
  const result = await benchmarkJudgingWorkload(
    {
      origin: "https://fixture.test",
      actors: [{ id: "a", workspaceId: "w", headers: {} }],
      cases: [{ args: [], expected: 7 }],
      source: "fixture",
    },
    async () => new Response(null, { status: 503 }),
  );
  assert.equal(result.meetsTarget, false);
  assert.deepEqual(result.samples, []);
  assert.equal(result.errors[0].stage, "admission");
  assert.equal(result.errors[0].status, 503);
});
