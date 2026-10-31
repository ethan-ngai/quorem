import { test } from "node:test";
import assert from "node:assert/strict";
import { stageConfig } from "./hono-stage-config.mjs";
const input = () => ({
  stageZone: "example",
  vars: {
    APP_ENV: "stage",
    ALLOWED_ORIGINS: "https://stage.example",
    AUTH_ORIGIN: "https://stage.example",
    AUTH_MODE: "password",
    HTTP_MAX_REQUESTS: "16",
    DEADLINE_SHARDS: "2",
    GUEST_CREATION: "false",
    GUEST_ADMISSION: "true",
    GUEST_EXECUTION: "false",
    VERIFICATION_SERVICE_ORIGIN: "https://verify.example",
    VERIFICATION_ACCESS_MODE: "cloudflare-access",
    VERIFICATION_PUBLIC_KEY: "MCowBQYDK2VwAyEAtnR6Tl2sbDUoUU1629wFNWRHL+Y/6q19G/75ULZd7Kw=",
    EXECUTION_DRAIN_URL: "https://runner-stage.example/internal/drain",
    EXECUTION_DRAIN_ACCESS_MODE: "cloudflare-access",
  },
});
const outputs = () => ({
  worker_name: { value: "quorem-hono-stage" },
  stage_hostname: { value: "stage.example" },
  hyperdrive_id: { value: "a".repeat(32) },
  queue_name: { value: "quorem-hono-stage-execution" },
  internal_access_application_id: { value: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  drain_hostname: { value: "runner-stage.example" },
  drain_access_application_id: { value: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
});
void test("stage binds actual runtime classes, queue and scheduled recovery without secrets", () => {
  const config = stageConfig(input(), outputs(), "/tmp/wrangler.json");
  assert.deepEqual(
    config.durable_objects.bindings.map((b) => b.class_name),
    ["BrowserSockets", "DeadlineCoordinator", "ExecutionRecovery"],
  );
  assert.deepEqual(config.migrations, [
    {
      tag: "v1",
      new_sqlite_classes: ["BrowserSockets", "DeadlineCoordinator", "ExecutionRecovery"],
    },
  ]);
  assert.deepEqual(config.hyperdrive, [{ binding: "DB", id: "a".repeat(32) }]);
  assert.deepEqual(config.queues, {
    producers: [{ binding: "EXECUTION_QUEUE", queue: "quorem-hono-stage-execution" }],
  });
  assert.deepEqual(config.triggers.crons, ["* * * * *"]);
  assert.deepEqual(
    config.routes.map((route) => route.pattern),
    [
      "stage.example/v1/*",
      "stage.example/api/auth/*",
      "stage.example/health",
      "stage.example/internal/*",
    ],
  );
  assert.equal(config.vars.EXECUTION_WAKE_PROVIDER, "cloudflare-binding");
  assert.equal(config.vars.GUEST_CREATION, "false");
  assert.equal(config.vars.GUEST_ADMISSION, "true");
  assert.equal(config.workers_dev, false);
  assert.doesNotMatch(
    JSON.stringify(config),
    /RUNNER_PEERS|MATCH_INVITE_KEY|PRIVATE_KEY|DRAIN_SECRET/,
  );
});
void test("rejects live names, non-stage queue, insecure private endpoints and secrets", () => {
  for (const change of [
    { vars: { ...input().vars, EXECUTION_DRAIN_URL: "http://drain.example/internal/drain" } },
    { vars: { ...input().vars, MATCH_INVITE_KEY: "secret" } },
    { vars: { ...input().vars, APP_ENV: "local" } },
    { vars: { ...input().vars, AUTH_MODE: "" } },
    { vars: { ...input().vars, AUTH_MODE: "invalid" } },
    { vars: { ...input().vars, EXECUTION_DRAIN_ACCESS_MODE: "none" } },
    { vars: { ...input().vars, VERIFICATION_ACCESS_MODE: "none" } },
    { vars: { ...input().vars, ALLOWED_ORIGINS: "https://stage.example/path" } },
    { vars: { ...input().vars, PROFILE_MEDIA_ENABLED: "true" } },
    { vars: { ...input().vars, AUTH_ORIGIN: "https://www.example" } },
    { vars: { ...input().vars, HTTP_MAX_REQUESTS: "999999" } },
    { vars: { ...input().vars, VERIFICATION_PUBLIC_KEY: "invalid" } },
  ])
    assert.throws(() => stageConfig({ ...input(), ...change }, outputs(), "/tmp/wrangler.json"));
});

void test("resources must match Terraform outputs", () => {
  for (const change of [
    { worker_name: { value: "quorem-production" } },
    { queue_name: { value: "production" } },
    { hyperdrive_id: { value: "placeholder" } },
    { internal_access_application_id: { value: "" } },
    { drain_hostname: { value: "other.example" } },
  ])
    assert.throws(() => stageConfig(input(), { ...outputs(), ...change }, "/tmp/wrangler.json"));
});

void test("profile binding must use the actual provisioned bucket and explicit private image mode", () => {
  const i = input();
  Object.assign(i.vars, {
    PROFILE_MEDIA_ENABLED: "true",
    PROFILE_IMAGE_SERVICE_URL: "https://image-stage.example",
    PROFILE_IMAGE_ACCESS_MODE: "cloudflare-access",
  });
  const o = { ...outputs(), profile_bucket_name: { value: "quorem-hono-stage-profile" } };
  assert.equal(
    stageConfig(i, o, "/tmp/wrangler.json").r2_buckets[0].bucket_name,
    "quorem-hono-stage-profile",
  );
  assert.throws(() =>
    stageConfig({ ...i, profileBucket: "another-bucket" }, o, "/tmp/wrangler.json"),
  );
  assert.throws(() => stageConfig(i, outputs(), "/tmp/wrangler.json"));
  assert.throws(() =>
    stageConfig(
      { ...i, vars: { ...i.vars, PROFILE_IMAGE_ACCESS_MODE: "none" } },
      o,
      "/tmp/wrangler.json",
    ),
  );
});
