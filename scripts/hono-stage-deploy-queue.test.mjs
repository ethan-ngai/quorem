import { test } from "node:test";
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
  TF_VAR_enable_queue_consumer: "false",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  TF_STATE_BUCKET: "fixture-state",
  TF_VAR_stage_hostname: "api-stage.example.com",
  TF_VAR_drain_hostname: "drain-stage.example.com",
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
    accept: async (v) => calls.push(v.HONO_STAGE_ACCEPTANCE_MODE),
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
      },
      ingress: async () => {},
      change: async (_, enabled) => {
        if (!enabled) throw new Error();
      },
    }),
    /detachment is unconfirmed/,
  );
});
