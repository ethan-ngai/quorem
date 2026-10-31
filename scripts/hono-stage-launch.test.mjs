import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { bootstrapEnvironment, launchStage, validateStageIntent } from "./hono-stage-launch.mjs";

const env = () => ({
  GITHUB_REF: "refs/heads/feat/hono-migration",
  GITHUB_SHA: "c".repeat(40),
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_ZONE_ID: "b".repeat(32),
  TF_STATE_BUCKET: "stage-state",
  CLOUDFLARE_API_TOKEN: "fixture-cloud-token",
  NEON_API_KEY: "fixture-neon-token",
  AWS_ACCESS_KEY_ID: "fixture-access",
  AWS_SECRET_ACCESS_KEY: "fixture-secret",
  QUOREM_REMOTE_VALIDATION_DATABASE_URL:
    "postgres://fixture:fixture@127.0.0.1:54329/quorem_hono_remote_validation_test?sslmode=disable",
});
const output = (secrets) => ({
  stage_secrets: { value: secrets },
  database_url: {
    value:
      "postgres://operator:fixture-password@db.example.test/quorem_hono_stage?sslmode=verify-full",
  },
  access_tokens: {
    value: Object.fromEntries(
      ["runner_api", "verifier_api", "drain", "verifier", "case", "image"].map((name, i) => [
        name,
        {
          id: `00000000-0000-4000-8000-00000000000${i}`,
          client_id: `fixture-id-${i}`,
          client_secret: String(i).repeat(64),
        },
      ]),
    ),
  },
});
const images = (account) =>
  Object.fromEntries(
    ["runner", "verifier", "image", "python", "java", "typescript", "ocaml", "postgresql"].map(
      (name) => [name, `registry.cloudflare.com/${account}/${name}@sha256:${"d".repeat(64)}`],
    ),
  );
function terraform(changes, saved, calls, drift = []) {
  return (_program, args) => {
    calls.push(args[1]);
    if (args[1] === "plan")
      writeFileSync(args.find((arg) => arg.startsWith("-out=")).slice(5), "fixture plan");
    if (args[1] === "show")
      return JSON.stringify({ resource_changes: changes, resource_drift: drift });
    if (args[1] === "output") return JSON.stringify(output(saved));
    return "";
  };
}
const change = (address, actions) => ({ address, change: { actions } });

void test("intent requires an explicit stage request and exact dispatch revision", () => {
  const actionEnv = {
    ...env(),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    HONO_BOOTSTRAP_ACTION: "stage",
    HONO_RELEASE_SHA: "c".repeat(40),
  };
  assert.equal(validateStageIntent(actionEnv), "stage");
  assert.throws(() => validateStageIntent({ ...actionEnv, HONO_RELEASE_SHA: "d".repeat(40) }));
  assert.equal(
    validateStageIntent(
      { ...env(), GITHUB_EVENT_NAME: "push" },
      { action: "stage", operation: randomUUID() },
    ),
    "stage",
  );
  assert.throws(() =>
    validateStageIntent(
      { ...env(), GITHUB_EVENT_NAME: "push" },
      { action: "stage", operation: "bad" },
    ),
  );
  assert.throws(() => bootstrapEnvironment({ ...env(), GITHUB_REF: "refs/heads/main" }, {}));
});

void test("plan refuses destructive, drift and unrelated resources before apply", async () => {
  for (const changes of [
    [change("neon_project.stage", ["delete", "create"])],
    [change("neon_project.other", ["create"])],
    [change("terraform_data.stage_secrets", ["update"])],
  ]) {
    const calls = [];
    await assert.rejects(
      launchStage(env(), {
        action: "stage",
        run: terraform(changes, createStageSecrets(), calls),
        freshness: async () => {},
      }),
      /unrelated or destructive/,
    );
    assert.deepEqual(calls, ["init", "plan", "show"]);
  }
  const calls = [];
  await assert.rejects(
    launchStage(env(), {
      action: "stage",
      run: terraform([], createStageSecrets(), calls, [change("neon_project.stage", ["update"])]),
      freshness: async () => {},
    }),
    /unrelated or destructive/,
  );
  assert.deepEqual(calls, ["init", "plan", "show"]);
});

void test("stage reuses stored secrets and publishes genuine images exactly once", async () => {
  const calls = [],
    expected = createStageSecrets(),
    proposed = createStageSecrets(),
    masked = [],
    releaseEnv = env();
  let publishes = 0,
    activations = 0;
  const published = images(releaseEnv.CLOUDFLARE_ACCOUNT_ID);
  const result = await launchStage(releaseEnv, {
    action: "stage",
    run: terraform(
      [change("neon_project.stage", ["create"]), change("terraform_data.stage_secrets", ["no-op"])],
      expected,
      calls,
    ),
    createSecrets: () => proposed,
    freshness: async () => {
      calls.push("freshness");
    },
    mask: (value) => masked.push(value),
    images: async (configured) => {
      publishes++;
      assert.equal(
        JSON.parse(configured.TF_VAR_service_secrets).RECOVERY_CONTROL_SECRET,
        expected.RECOVERY_CONTROL_SECRET,
      );
      return published;
    },
    activate: async (configured, operations) => {
      activations++;
      assert.equal(configured.TF_VAR_runner_image, published.runner);
      assert.equal(configured.TF_VAR_image_service_image, published.image);
      assert.deepEqual(operations.images(), published);
      return { status: "fixture" };
    },
  });
  assert.deepEqual(result, { status: "fixture" });
  assert.deepEqual(calls, ["freshness", "init", "plan", "show", "apply", "output"]);
  assert.equal(publishes, 1);
  assert.equal(activations, 1);
  assert.ok(masked.includes(expected.RECOVERY_CONTROL_SECRET));
  assert.ok(masked.includes("fixture-password"));
  assert.equal(JSON.stringify(result).includes(expected.RECOVERY_CONTROL_SECRET), false);
});

void test("plan returns only allowed addresses and never publishes or applies", async () => {
  const calls = [],
    saved = createStageSecrets();
  const result = await launchStage(env(), {
    action: "plan",
    run: terraform([change("neon_project.stage", ["create"])], saved, calls),
    images: () => {
      throw new Error("unexpected publish");
    },
    activate: () => {
      throw new Error("unexpected activation");
    },
  });
  assert.deepEqual(calls, ["init", "plan", "show"]);
  assert.deepEqual(result, {
    status: "planned",
    resources: [{ address: "neon_project.stage", actions: ["create"] }],
  });
  assert.equal(JSON.stringify(result).includes(saved.RECOVERY_CONTROL_SECRET), false);
});
