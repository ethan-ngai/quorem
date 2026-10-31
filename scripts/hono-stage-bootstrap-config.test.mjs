import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleStageConfig, createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { validateStageRequest } from "./hono-stage-deploy.mjs";
import { checkWorkerAuth } from "./hono-stage-preflight.mjs";
import { deployStage } from "./hono-stage-deploy-stage.mjs";

const bootstrap = () => ({
  project_id: { value: "fixture-existing-project" },
  branch_id: { value: "br-stage-fixture" },
  stage_secrets: { value: createStageSecrets() },
  database_url: {
    value:
      "postgres://operator:fixture-password@db.example.test:5432/quorem_hono_stage?sslmode=verify-full",
  },
});
const actions = () => ({
  NEON_PROJECT_ID: "fixture-existing-project",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_ZONE_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture-api-token-123456",
  AWS_ACCESS_KEY_ID: "fixture-access",
  AWS_SECRET_ACCESS_KEY: "fixture-secret",
  TF_STATE_BUCKET: "fixture-state",
  GITHUB_REF: "refs/heads/feat/hono-migration",
  GITHUB_SHA: "c".repeat(40),
  QUOREM_REMOTE_VALIDATION_DATABASE_URL:
    "postgres://fixture:fixture@127.0.0.1:54329/quorem_hono_remote_validation_test?sslmode=disable",
});
void test("assembles distinct private credentials and validates actual stage auth", () => {
  const saved = bootstrap(),
    result = assembleStageConfig(saved, actions());
  validateStageRequest(result, { requireImages: false });
  const input = JSON.parse(result.HONO_STAGE_PUBLIC_JSON),
    secrets = JSON.parse(result.HONO_WORKER_SECRETS_JSON),
    services = JSON.parse(result.TF_VAR_service_secrets);
  checkWorkerAuth(input.vars, secrets, true);
  assert.equal(input.vars.AUTH_LOGIN_ONLY, "true");
  assert.equal(input.vars.PROFILE_MEDIA_ENABLED, "true");
  assert.equal(result.TF_VAR_dns_target, undefined);
  assert.equal(result.TF_VAR_enable_queue_consumer, "false");
  assert.equal(result.TF_VAR_database_connection_limit, "5");
  assert.equal(
    result.HONO_STAGE_DATABASE_IDENTITY,
    "fixture-existing-project:br-stage-fixture:quorem_hono_stage",
  );
  assert.equal(services.IMAGE_SERVICE_TOKEN, secrets.PROFILE_IMAGE_SERVICE_TOKEN);
  assert.notEqual(services.QUOREM_CASE_SECRET, services.QUOREM_RUNNER_COMMAND_SECRET);
  assert.notEqual(result.TF_VAR_database_password, "fixture-password");
  assert.equal(
    JSON.parse(assembleStageConfig(saved, actions()).TF_VAR_service_secrets)
      .RECOVERY_CONTROL_SECRET,
    services.RECOVERY_CONTROL_SECRET,
  );
  assert.equal(
    result.TF_VAR_database_password,
    saved.stage_secrets.value.STAGE_RUNTIME_DATABASE_PASSWORD,
  );
  assert.notEqual(createStageSecrets().RECOVERY_CONTROL_SECRET, services.RECOVERY_CONTROL_SECRET);
});
void test("rejects non-isolated database, mismatched signing keys and wrong release", () => {
  const db = bootstrap();
  db.database_url.value =
    "postgres://operator:fixture@db.example.test/production?sslmode=verify-full";
  assert.throws(() => assembleStageConfig(db, actions()));
  const invalid = bootstrap();
  invalid.stage_secrets.value.VERIFICATION_PUBLIC_KEY =
    createStageSecrets().VERIFICATION_PUBLIC_KEY;
  assert.throws(() => assembleStageConfig(invalid, actions()));
  const missing = bootstrap();
  delete missing.stage_secrets;
  assert.throws(() => assembleStageConfig(missing, actions()));
  assert.throws(() =>
    assembleStageConfig({ ...bootstrap(), branch_id: { value: "bad/branch" } }, actions()),
  );
  assert.throws(() =>
    assembleStageConfig(bootstrap(), { ...actions(), NEON_PROJECT_ID: "other-project" }),
  );
  assert.throws(() =>
    assembleStageConfig(bootstrap(), { ...actions(), GITHUB_REF: "refs/heads/main" }),
  );
});

void test("real stage preflight accepts assembled inputs before any provider operation", async () => {
  const env = assembleStageConfig(bootstrap(), actions());
  const digest = (name) =>
    `registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/${name}@sha256:${"d".repeat(64)}`;
  env.TF_VAR_runner_image = digest("runner");
  env.TF_VAR_verifier_image = digest("verifier");
  env.TF_VAR_image_service_image = digest("image");
  env.TF_VAR_case_images = JSON.stringify(
    Object.fromEntries(
      ["python", "java", "typescript", "ocaml", "postgresql"].map((name) => [name, digest(name)]),
    ),
  );
  await assert.rejects(
    deployStage(env, {
      freshness: async () => {
        throw new Error("fixture reached provider boundary");
      },
    }),
    /fixture reached provider boundary/,
  );
});
