import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectProductionPlan } from "./hono-production-terraform.mjs";
const plan = (address, actions, after) => ({
  resource_changes: [{ address, change: { actions, after } }],
});
void test("cutover changes only existing API routes; Pages and other workers stay protected", () => {
  assert.doesNotThrow(() =>
    inspectProductionPlan(
      plan('cloudflare_workers_route.api["/v1/*"]', ["update"], {
        script: "quorem-hono-production",
      }),
      "routes",
    ),
  );
  for (const address of [
    "cloudflare_pages_project.frontend",
    "cloudflare_dns_record.frontend",
    "cloudflare_worker.app",
  ])
    assert.throws(() => inspectProductionPlan(plan(address, ["delete"]), "routes"));
  assert.throws(() =>
    inspectProductionPlan(
      plan('cloudflare_workers_route.api["/v1/*"]', ["update"], { script: "unexpected" }),
      "routes",
    ),
  );
});
void test("legacy retirement deletes only backend resources; snapshots and data cannot be deleted", () => {
  assert.doesNotThrow(() =>
    inspectProductionPlan(plan("restapi_object.container", ["delete"]), "legacy-stop"),
  );
  for (const address of [
    "cloudflare_pages_project.frontend",
    "cloudflare_workers_route.api",
    "neon_project.production",
    "cloudflare_hyperdrive_config.database",
  ])
    assert.throws(() => inspectProductionPlan(plan(address, ["delete"]), "legacy-stop"));
  assert.throws(() =>
    inspectProductionPlan(plan("cloudflare_worker.api", ["delete"]), "provision"),
  );
  assert.doesNotThrow(() =>
    inspectProductionPlan(
      {
        resource_drift: [
          { address: "cloudflare_queue.execution", change: { actions: ["update"] } },
        ],
      },
      "routes",
    ),
  );
});
