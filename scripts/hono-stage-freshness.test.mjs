import { test } from "node:test";
import assert from "node:assert/strict";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";
const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture-token-at-least-16",
  HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
  TF_VAR_worker_name: "quorem-hono-stage",
};
function list(workers, namespaces) {
  return async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    const rows = url.pathname.endsWith("/workers/workers") ? workers : namespaces;
    const page = Number(url.searchParams.get("page")),
      part = rows.slice((page - 1) * 100, page * 100);
    return Response.json({
      success: true,
      result: part,
      result_info: {
        page,
        per_page: 100,
        count: part.length,
        total_count: rows.length,
        total_pages: Math.ceil(rows.length / 100),
      },
    });
  };
}
void test("checks every provider page and rejects either existing stage owner", async () => {
  const workers = Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: `worker-${i}` }));
  assert.equal((await requireFreshStageResources(env, list(workers, []))).workersChecked, 101);
  for (const [w, n] of [
    [[{ id: "1", name: env.TF_VAR_worker_name }], []],
    [[], [{ id: "1", script: env.HONO_SERVICES_WORKER_NAME }]],
  ])
    await assert.rejects(requireFreshStageResources(env, list(w, n)), /freshness/);
});
void test("fails closed on missing metadata, duplicate entries and provider errors", async () => {
  await assert.rejects(
    requireFreshStageResources(env, async () => Response.json({ success: true, result: [] })),
    /freshness/,
  );
  await assert.rejects(
    requireFreshStageResources(
      env,
      list(
        [
          { id: "1", name: "x" },
          { id: "1", name: "y" },
        ],
        [],
      ),
    ),
    /freshness/,
  );
  await assert.rejects(
    requireFreshStageResources(env, async () => new Response(null, { status: 403 })),
    /freshness/,
  );
  await assert.rejects(
    requireFreshStageResources({ ...env, CLOUDFLARE_ACCOUNT_ID: "invalid" }, list([], [])),
    /Invalid/,
  );
});
void test("reports only redacted provider status and inventory metadata", async () => {
  const reports = [];
  await requireFreshStageResources(
    env,
    list([{ id: "private-id", name: "private-name" }], []),
    (phase, metadata) => reports.push({ phase, metadata }),
  );
  assert.deepEqual(reports[0], { phase: "workers", metadata: { status: 200, page: 1 } });
  assert.deepEqual(reports[1].metadata, {
    success: true,
    resultArray: true,
    resultInfo: true,
    page: 1,
    perPage: 100,
    count: 1,
    totalCount: 1,
    totalPages: 1,
    resultCount: 1,
    idPresent: true,
    ownerPresent: true,
  });
  assert.equal(reports[2].phase, "namespaces");
  assert.doesNotMatch(JSON.stringify(reports), /private-id|private-name|fixture-token/);
  reports.length = 0;
  await assert.rejects(
    requireFreshStageResources(
      env,
      async () => new Response("private-body", { status: 403 }),
      (phase, metadata) => reports.push({ phase, metadata }),
    ),
    /freshness/,
  );
  assert.deepEqual(reports, [
    { phase: "workers", metadata: { status: 403, page: 1 } },
    { phase: "failure", metadata: { reason: "unavailable" } },
  ]);
});
