import { test } from "node:test";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import assert from "node:assert/strict";
import { releaseQueue, setQueue } from "./hono-stage-deploy-queue.mjs";
const env = () => ({
  HONO_STAGE_ACTION: "stage",
  GITHUB_REF: "refs/heads/feat/hono-migration",
  HONO_RELEASE_SHA: "a".repeat(40),
  GITHUB_SHA: "a".repeat(40),
  TF_VAR_database_name: "quorem_hono_stage",
  TF_VAR_case_namespace_id: "a".repeat(64),
  TF_VAR_worker_name: "quorem-hono-stage",
  HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
  TF_VAR_access_service_token_ids: JSON.stringify(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]),
  TF_VAR_access_token_ids: JSON.stringify({
    drain: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    verifier: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    case: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  }),
  TF_VAR_enable_queue_consumer: "false",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  TF_STATE_BUCKET: "fixture-state",
  TF_VAR_stage_hostname: "api-stage.example.com",
  TF_VAR_hostnames: JSON.stringify({
    drain: "drain-stage.example.com",
    verifier: "verify-stage.example.com",
    case: "case-stage.example.com",
  }),
  TF_VAR_command_origin: "https://api-stage.example.com",
  TF_VAR_source_origin: "https://api-stage.example.com",
  TF_VAR_runner_image: `registry.cloudflare.com/${"b".repeat(32)}/runner@sha256:${"c".repeat(64)}`,
  TF_VAR_verifier_image: `registry.cloudflare.com/${"b".repeat(32)}/verifier@sha256:${"c".repeat(64)}`,
  TF_VAR_case_images: JSON.stringify(
    Object.fromEntries(
      ["python", "java", "typescript", "ocaml", "postgresql"].map((k) => [
        k,
        `registry.cloudflare.com/${"b".repeat(32)}/${k}@sha256:${"c".repeat(64)}`,
      ]),
    ),
  ),
});
void test("requires manual and private controls before automatic queue proof", async () => {
  const calls = [];
  await releaseQueue(env(), "a".repeat(64), {
    accept: async (v) => {
      calls.push(v.HONO_STAGE_ACCEPTANCE_MODE);
      return { submission: v.HONO_STAGE_ACCEPTANCE_MODE };
    },
    ingress: async () => calls.push("ingress"),
    change: async (_, enabled) => calls.push(enabled),
  });
  assert.deepEqual(calls, ["manual", "ingress", true, "queue"]);
});
void test("attempts detach for unknown attach and failed automatic proof", async () => {
  for (const fail of ["attach", "queue"]) {
    const calls = [];
    await assert.rejects(
      releaseQueue(env(), "a".repeat(64), {
        accept: async (v) => {
          calls.push(v.HONO_STAGE_ACCEPTANCE_MODE);
          if (fail === "queue" && v.HONO_STAGE_ACCEPTANCE_MODE === "queue") throw new Error();
          return { submission: v.HONO_STAGE_ACCEPTANCE_MODE };
        },
        ingress: async () => calls.push("ingress"),
        change: async (_, enabled) => {
          calls.push(enabled);
          if (fail === "attach" && enabled) throw new Error();
        },
      }),
      /detached/,
    );
    assert.equal(calls.at(-1), false);
  }
});
void test("pre-attach failures never mutate and secret-bearing provider output is withheld", async () => {
  let called = false;
  await assert.rejects(
    releaseQueue(env(), "a".repeat(64), {
      accept: async () => {
        throw new Error();
      },
      change: async () => {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
  assert.throws(
    () =>
      setQueue({ ...env(), CASE_OWNER_PRIVATE_KEY: "fixture" }, true, (_, __, options) => {
        assert.equal(options.env.CASE_OWNER_PRIVATE_KEY, undefined);
        return { status: 1, stderr: "fixture-secret" };
      }),
    (error) => !String(error).includes("fixture-secret"),
  );
});

void test("namespace mismatch and failed detachment are explicit", async () => {
  await assert.rejects(releaseQueue(env(), "b".repeat(64)), /namespace/);
  await assert.rejects(
    releaseQueue(env(), "a".repeat(64), {
      accept: async (v) => {
        if (v.HONO_STAGE_ACCEPTANCE_MODE === "queue") throw new Error();
        return { submission: "manual" };
      },
      ingress: async () => {},
      change: async (_, enabled) => {
        if (!enabled) throw new Error();
      },
    }),
    /detachment is unconfirmed/,
  );
});

void test("profile proof is mandatory before attaching queue when enabled", async () => {
  const calls = [];
  await releaseQueue({ ...env(), PROFILE_MEDIA_ENABLED: "true" }, "a".repeat(64), {
    accept: async (v) => {
      calls.push(v.HONO_STAGE_ACCEPTANCE_MODE);
      return { submission: "fixture" };
    },
    ingress: async () => calls.push("ingress"),
    profile: async () => calls.push("profile"),
    change: async (_, enabled) => calls.push(enabled),
  });
  assert.deepEqual(calls, ["manual", "ingress", "profile", true, "queue"]);
});

void test("applies only a validated saved consumer plan and removes its private file", () => {
  for (const enabled of [true, false]) {
    let planPath,
      applied = false;
    const calls = [];
    setQueue(env(), enabled, (_, args) => {
      calls.push(args);
      if (args[1] === "plan") {
        assert.ok(args.includes("-target=cloudflare_queue_consumer.execution"));
        planPath = args.find((arg) => arg.startsWith("-out=")).slice(5);
        writeFileSync(planPath, "private plan");
        assert.equal(statSync(dirname(planPath)).mode & 0o777, 0o700);
        return { status: 0, stdout: "" };
      }
      if (args[1] === "show") {
        assert.equal(statSync(planPath).mode & 0o777, 0o600);
        return {
          status: 0,
          stdout: JSON.stringify({
            resource_changes: [
              {
                address: "cloudflare_queue_consumer.execution[0]",
                change: { actions: [enabled ? "create" : "delete"] },
              },
              { address: "cloudflare_queue.execution", change: { actions: ["no-op"] } },
            ],
            planned_values: {
              root_module: {
                resources: enabled
                  ? [{ address: "cloudflare_queue_consumer.execution[0]", mode: "managed" }]
                  : [],
              },
            },
          }),
        };
      }
      assert.equal(args[1], "apply");
      assert.equal(args.at(-1), planPath);
      applied = true;
      return { status: 0, stdout: "" };
    });
    assert.equal(applied, true);
    assert.equal(existsSync(planPath), false);
    assert.deepEqual(
      calls.map((args) => args[1]),
      ["plan", "show", "apply"],
    );
  }
});
void test("rejects dependency mutation, malformed plans and unreviewed replacement", () => {
  for (const change of [
    { address: "cloudflare_hyperdrive_config.database", change: { actions: ["update"] } },
    { address: "cloudflare_queue.execution", change: { actions: ["update"] } },
    {
      address: "cloudflare_queue_consumer.execution[0]",
      change: { actions: ["delete", "create"] },
    },
    { address: "cloudflare_queue_consumer.execution[0]", change: {} },
  ]) {
    let planPath,
      applied = false;
    assert.throws(() =>
      setQueue(env(), true, (_, args) => {
        if (args[1] === "plan") {
          planPath = args.find((arg) => arg.startsWith("-out=")).slice(5);
          writeFileSync(planPath, "fixture");
          return { status: 0 };
        }
        if (args[1] === "show")
          return {
            status: 0,
            stdout: JSON.stringify({
              resource_changes: [change],
              planned_values: {
                root_module: {
                  resources: [
                    { address: "cloudflare_queue_consumer.execution[0]", mode: "managed" },
                  ],
                },
              },
            }),
          };
        applied = true;
        return { status: 0 };
      }),
    );
    assert.equal(applied, false);
    assert.equal(existsSync(planPath), false);
  }
});
