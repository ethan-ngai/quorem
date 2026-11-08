import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectProductionPlan } from "./hono-production-terraform.mjs";
import { configureProductionHyperdrive } from "./hono-production-capacity.mjs";
const plan = (address, actions, after) => ({
  resource_changes: [{ address, change: { actions, after } }],
});

void test("Hyperdrive capacity plans change only the bounded origin connection budget", () => {
  const before = {
    name: "quorem-hono-production-database",
    origin_connection_limit: 10,
    origin: { host: "database.example.test", user: "runtime", password: "private" },
    caching: { disabled: true },
  };
  const after = { ...before, origin_connection_limit: 60 };
  const change = (target = after, source = before, actions = ["update"]) => ({
    resource_changes: [
      {
        address: "cloudflare_hyperdrive_config.database",
        change: { before: source, after: target, actions },
      },
    ],
  });
  assert.doesNotThrow(() => inspectProductionPlan(change(), "hyperdrive-capacity"));
  for (const target of [
    { ...after, origin: { ...after.origin, host: "other.example.test" } },
    { ...after, origin_connection_limit: 101 },
    { ...after, origin_connection_limit: 20 },
    { ...after, caching: { disabled: false } },
  ])
    assert.throws(() => inspectProductionPlan(change(target), "hyperdrive-capacity"));
  assert.throws(() =>
    inspectProductionPlan(
      change(after, { ...before, origin_connection_limit: 80 }),
      "hyperdrive-capacity",
    ),
  );
  assert.throws(() =>
    inspectProductionPlan(change(after, before, ["delete", "create"]), "hyperdrive-capacity"),
  );
});

void test("production capacity keeps database headroom and provisions only the existing Hyperdrive", async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "private-token" };
  const input = {
    id: "a".repeat(32),
    role: "runtime",
    password: "private-password",
    maxConnections: 112,
  };
  let applied = 0,
    currentLimit = 10;
  const dependencies = {
    fetch: async () =>
      Response.json({
        result: {
          name: "quorem-hono-production-database",
          origin_connection_limit: currentLimit,
          origin: {
            host: "database.example.test",
            port: 5432,
            database: "neondb",
            user: "runtime",
          },
        },
      }),
    terraform: async (child, directory, key, options) => {
      applied++;
      currentLimit = 60;
      assert.equal(child.TF_VAR_database_connection_limit, "60");
      assert.equal(child.TF_VAR_database_user, "runtime");
      assert.equal(directory, "hono-stage");
      assert.equal(key, "hono-production-api");
      assert.deepEqual(options.targets, ["cloudflare_hyperdrive_config.database"]);
      assert.equal(options.mode, "hyperdrive-capacity");
    },
  };
  await configureProductionHyperdrive(env, input, dependencies);
  assert.equal(applied, 1);
  await assert.rejects(
    configureProductionHyperdrive(env, { ...input, maxConnections: 64 }, dependencies),
    /headroom/,
  );
  await assert.rejects(
    configureProductionHyperdrive(env, { ...input, role: "different" }, dependencies),
    /Unexpected/,
  );
  assert.equal(applied, 1);
  currentLimit = 10;
  await assert.rejects(
    configureProductionHyperdrive(env, input, { ...dependencies, terraform: async () => {} }),
    /did not verify/,
  );
});
void test("native provisioning refuses to delete retained resources", () => {
  for (const address of [
    "cloudflare_worker.api",
    "cloudflare_pages_project.frontend",
    "neon_project.production",
    "cloudflare_hyperdrive_config.database",
  ])
    assert.throws(() => inspectProductionPlan(plan(address, ["delete"]), "provision"));
  assert.doesNotThrow(() =>
    inspectProductionPlan(
      {
        resource_drift: [
          { address: "cloudflare_queue.execution", change: { actions: ["update"] } },
        ],
      },
      "provision",
    ),
  );
});

void test("private rollout permits retiring only runner and verifier container resources", () => {
  for (const role of ["runner", "verifier"])
    for (const resource of ["trusted", "trusted_rollout"])
      assert.doesNotThrow(() =>
        inspectProductionPlan(
          plan(`restapi_object.${resource}["${role}"]`, ["delete"]),
          "private-workers",
        ),
      );
  const domain = 'cloudflare_workers_custom_domain.service["verifier"]';
  const prior = {
    hostname: "verifier-hono.quorem.app",
    service: "quorem-hono-services-production",
    zone_id: "zone",
    account_id: "account",
  };
  const target = { ...prior, service: "quorem-hono-services-production-verifier" };
  const replacement = plan(domain, ["delete", "create"], target);
  replacement.resource_changes[0].change.before = prior;
  assert.doesNotThrow(() => inspectProductionPlan(replacement, "private-workers"));
  assert.throws(() =>
    inspectProductionPlan(plan(domain, ["delete"], undefined), "private-workers"),
  );
  assert.throws(() =>
    inspectProductionPlan(
      plan(domain, ["update"], { ...target, hostname: "other.quorem.app" }),
      "private-workers",
    ),
  );
  for (const address of [
    'restapi_object.trusted["mail"]',
    "restapi_object.case",
    "cloudflare_worker.services",
    "terraform_data.case_namespace_pin[0]",
    'cloudflare_workers_custom_domain.service["case"]',
    "cloudflare_queue_consumer.execution[0]",
  ])
    for (const action of ["delete", "update"])
      assert.throws(() => inspectProductionPlan(plan(address, [action]), "private-workers"));
});

void test("private mail rollout changes only the image digest", () => {
  const image = `registry.cloudflare.com/${"a".repeat(32)}/quorem-hono-production-mail@sha256:${"b".repeat(64)}`;
  for (const rollout of [false, true]) {
    const address = rollout
      ? 'restapi_object.trusted_rollout["mail"]'
      : 'restapi_object.trusted["mail"]';
    const key = rollout ? "target_configuration" : "configuration";
    const before = {
      name: "quorem-hono-services-production-mail",
      [key]: { image: image.replace(/b{64}$/, "c".repeat(64)), vcpu: 1, memory_mib: 3072 },
    };
    const after = { ...before, [key]: { ...before[key], image } };
    const value = (target) => ({
      resource_changes: [
        {
          address,
          change: {
            actions: rollout ? ["create", "delete"] : ["update"],
            before: { data: JSON.stringify(before), update_data: JSON.stringify(before) },
            after: { data: JSON.stringify(target), update_data: JSON.stringify(target) },
          },
        },
      ],
    });
    assert.doesNotThrow(() => inspectProductionPlan(value(after), "private-workers"));
    for (const target of [
      { ...after, name: "other-service" },
      { ...after, [key]: { ...after[key], vcpu: 2 } },
      { ...after, [key]: { ...after[key], image: "untrusted/image:latest" } },
    ])
      assert.throws(() => inspectProductionPlan(value(target), "private-workers"));
  }
});
