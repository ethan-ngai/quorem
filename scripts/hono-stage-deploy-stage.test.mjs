import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { deployStage } from "./hono-stage-deploy-stage.mjs";
const ns = "a".repeat(64),
  account = "b".repeat(32);
const image = (role) => `registry.cloudflare.com/${account}/${role}@sha256:${"c".repeat(64)}`;
const outputs = {
  worker_name: { value: "quorem-hono-stage" },
  stage_hostname: { value: "api-stage.example.com" },
  hyperdrive_id: { value: "a".repeat(32) },
  queue_name: { value: "quorem-hono-stage-execution" },
  internal_access_application_id: { value: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  drain_hostname: { value: "drain-stage.example.com" },
  drain_access_application_id: { value: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
};
function env() {
  const input = JSON.parse(
    readFileSync(new URL("../deploy/hono/stage.fixture.json", import.meta.url)),
  );
  input.stageZone = "example.com";
  const caseKey = generateKeyPairSync("ed25519"),
    verifierKey = generateKeyPairSync("ed25519");
  input.vars.VERIFICATION_PUBLIC_KEY = verifierKey.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  Object.assign(input.vars, {
    AUTH_ORIGIN: "https://api-stage.example.com",
    ALLOWED_ORIGINS: "https://web-stage.example.com",
    VERIFICATION_SERVICE_ORIGIN: "https://verify-stage.example.com",
    EXECUTION_DRAIN_URL: "https://drain-stage.example.com/internal/drain",
  });
  const services = {
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: caseKey.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    CASE_OWNER_PRIVATE_KEY: caseKey.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: verifierKey.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    VERIFIER_API_ACCESS_CLIENT_ID: "verifier-api-id",
    VERIFIER_API_ACCESS_CLIENT_SECRET: "verifier-api-secret",
    QUOREM_CASE_SECRET: "c".repeat(32),
    QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
    QUOREM_CASE_ACCESS_CLIENT_SECRET: "case-secret",
    QUOREM_RUNNER_COMMAND_SECRET: "r".repeat(32),
    QUOREM_VERIFICATION_SOURCE_KEY: "a".repeat(64),
    QUOREM_VERIFICATION_SERVICE_KEY: "b".repeat(64),
    QUOREM_RUNNER_DRAIN_SECRET: "d".repeat(32),
    RUNNER_API_ACCESS_CLIENT_ID: "api-id",
    RUNNER_API_ACCESS_CLIENT_SECRET: "api-secret",
  };
  const secrets = {
    MATCH_INVITE_KEY: "ab".repeat(32),
    BETTER_AUTH_SECRET: "z".repeat(32),
    AUTH_INTERNAL_SECRET: "fixture",
    VERIFICATION_ACCESS_CLIENT_ID: "verifier-id",
    VERIFICATION_ACCESS_CLIENT_SECRET: "verifier-secret",
    EXECUTION_DRAIN_ACCESS_CLIENT_ID: "drain-id",
    EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "drain-secret",
  };
  return {
    HONO_STAGE_ACTION: "stage",
    GITHUB_REF: "refs/heads/feat/hono-migration",
    HONO_RELEASE_SHA: "a".repeat(40),
    GITHUB_SHA: "a".repeat(40),
    CLOUDFLARE_ACCOUNT_ID: account,
    TF_STATE_BUCKET: "fixture-state",
    TF_VAR_database_name: "quorem_hono_stage",
    TF_VAR_worker_name: "quorem-hono-stage",
    HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
    TF_VAR_enable_queue_consumer: "false",
    TF_VAR_case_namespace_id: "0".repeat(64),
    TF_VAR_runner_image: image("runner"),
    TF_VAR_verifier_image: image("verifier"),
    TF_VAR_case_images: JSON.stringify(
      Object.fromEntries(
        ["python", "java", "typescript", "ocaml", "postgresql"].map((k) => [k, image(k)]),
      ),
    ),
    TF_VAR_stage_hostname: "api-stage.example.com",
    TF_VAR_drain_hostname: "drain-stage.example.com",
    TF_VAR_hostnames: JSON.stringify({
      drain: "drain-stage.example.com",
      verifier: "verify-stage.example.com",
      case: "case-stage.example.com",
    }),
    TF_VAR_command_origin: "https://api-stage.example.com",
    TF_VAR_source_origin: "https://api-stage.example.com",
    HONO_STAGE_PUBLIC_JSON: JSON.stringify(input),
    TF_VAR_service_secrets: JSON.stringify(services),
    HONO_WORKER_SECRETS_JSON: JSON.stringify(secrets),
    HONO_STAGE_DATABASE_URL: "fixture",
    HONO_STAGE_BROWSER_ORIGIN: "https://web-stage.example.com",
  };
}
function operations(events, fail) {
  const step = (name, value) => {
    events.push(name);
    if (name === fail) throw new Error("fixture failure");
    return value;
  };
  return {
    fresh: async () => step("fresh"),
    migrate: () => step("migrate"),
    images: () =>
      step(
        "images",
        Object.fromEntries(
          ["runner", "verifier", "python", "java", "typescript", "ocaml", "postgresql"].map((k) => [
            k,
            image(k),
          ]),
        ),
      ),
    terraform: (_, stack, op) => step(`${stack}:${op}`),
    probe: async (_, pinned) =>
      step(`probe:${pinned === "0".repeat(64) ? "bootstrap" : "pinned"}`, {
        namespace: ns,
        scope: `remote:${"d".repeat(64)}`,
      }),
    outputs: () => step("outputs", outputs),
    deploy: () => step("deploy"),
    upload: () => step("upload"),
    subdomains: async () => step("subdomains"),
    detach: async () => step("detach"),
    cleanup: async (dir) => {
      await rm(dir, { recursive: true, force: true });
      step("cleanup");
    },
    remote: () => step("remote"),
    actor: async () =>
      step("actor", {
        sessionCookie: "fixture",
        problemVersionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        acceptedSource: "fixture",
        dispose: async () => step("dispose"),
      }),
    queue: async (e, namespace) => {
      assert.equal(e.TF_VAR_case_namespace_id, namespace);
      step("queue");
      return { manual: "manual-submission", automatic: "automatic-submission" };
    },
  };
}
void test("first activation checks fresh DB before mutations and proves queue last", async () => {
  const events = [];
  const receipt = await deployStage(env(), operations(events));
  assert.equal(receipt.cutoverReady, false);
  assert.equal(receipt.acceptance.automatic, "automatic-submission");
  assert.deepEqual(events, [
    "fresh",
    "hono-services:init",
    "hono-services:plan",
    "hono-stage:init",
    "hono-stage:apply",
    "migrate",
    "images",
    "hono-services:apply",
    "probe:bootstrap",
    "hono-services:apply",
    "outputs",
    "deploy",
    "upload",
    "subdomains",
    "remote",
    "actor",
    "queue",
    "dispose",
    "cleanup",
  ]);
});
void test("fresh failure causes no later action; queue failure disposes fixture", async () => {
  let events = [];
  await assert.rejects(deployStage(env(), operations(events, "fresh")));
  assert.deepEqual(events, ["fresh"]);
  events = [];
  await assert.rejects(deployStage(env(), operations(events, "queue")));
  assert.deepEqual(events.slice(-2), ["dispose", "cleanup"]);
});
void test("existing pin is verified before service apply", async () => {
  const events = [],
    input = { ...env(), TF_VAR_case_namespace_id: ns };
  await deployStage(input, operations(events));
  assert.ok(events.indexOf("probe:pinned") < events.indexOf("hono-services:apply"));
});

void test("invalid secrets fail before any database or cloud operation", async () => {
  const input = env(),
    events = [];
  const secrets = JSON.parse(input.HONO_WORKER_SECRETS_JSON);
  secrets.BETTER_AUTH_SECRET = "short";
  input.HONO_WORKER_SECRETS_JSON = JSON.stringify(secrets);
  await assert.rejects(deployStage(input, operations(events)));
  assert.deepEqual(events, []);
});

void test("mismatched signing keys and duplicate private credentials fail before mutations", async () => {
  for (const change of ["key", "secret"]) {
    const input = env(),
      events = [],
      services = JSON.parse(input.TF_VAR_service_secrets);
    if (change === "key")
      services.CASE_OWNER_PRIVATE_KEY = generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "der" })
        .toString("base64");
    else services.QUOREM_CASE_SECRET = services.QUOREM_RUNNER_DRAIN_SECRET;
    input.TF_VAR_service_secrets = JSON.stringify(services);
    await assert.rejects(deployStage(input, operations(events)));
    assert.deepEqual(events, []);
  }
});

void test("pin-plan failure stops before migrations and image publication", async () => {
  const events = [];
  await assert.rejects(deployStage(env(), operations(events, "hono-services:plan")));
  assert.deepEqual(events, ["fresh", "hono-services:init", "hono-services:plan", "cleanup"]);
});

void test("failure after queue attachment detaches and reports uncertain detach", async () => {
  for (const failure of ["dispose", "cleanup"]) {
    const events = [];
    await assert.rejects(deployStage(env(), operations(events, failure)), /cleanup failed/);
    assert.equal(events.at(-1), "detach");
  }
  const events = [],
    ops = operations(events, "dispose");
  ops.detach = async () => {
    throw new Error("provider output");
  };
  await assert.rejects(deployStage(env(), ops), /detachment is unconfirmed/);
});

void test("optional profile media requires matching Terraform outputs and isolated credentials", async () => {
  const input = env(),
    events = [],
    publicInput = JSON.parse(input.HONO_STAGE_PUBLIC_JSON),
    service = JSON.parse(input.TF_VAR_service_secrets),
    secrets = JSON.parse(input.HONO_WORKER_SECRETS_JSON);
  input.TF_VAR_profile_media_enabled = "true";
  input.TF_VAR_image_hostname = "image-stage.example.com";
  input.TF_VAR_image_access_service_token_id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  input.TF_VAR_image_service_image = image("image");
  Object.assign(publicInput.vars, {
    PROFILE_MEDIA_ENABLED: "true",
    PROFILE_IMAGE_SERVICE_URL: "https://image-stage.example.com",
    PROFILE_IMAGE_ACCESS_MODE: "cloudflare-access",
  });
  Object.assign(secrets, {
    PROFILE_IMAGE_SERVICE_TOKEN: "p".repeat(32),
    PROFILE_IMAGE_ACCESS_CLIENT_ID: "profile-id",
    PROFILE_IMAGE_ACCESS_CLIENT_SECRET: "profile-secret",
  });
  service.IMAGE_SERVICE_TOKEN = secrets.PROFILE_IMAGE_SERVICE_TOKEN;
  input.HONO_STAGE_PUBLIC_JSON = JSON.stringify(publicInput);
  input.TF_VAR_service_secrets = JSON.stringify(service);
  input.HONO_WORKER_SECRETS_JSON = JSON.stringify(secrets);
  const ops = operations(events),
    baseImages = ops.images;
  ops.images = () => ({ ...baseImages(), image: image("image") });
  ops.outputs = () => {
    events.push("outputs");
    return { ...outputs, profile_bucket_name: { value: "quorem-hono-stage-profile" } };
  };
  await deployStage(input, ops);
  assert.ok(events.includes("queue"));
  service.IMAGE_SERVICE_TOKEN = "wrong";
  input.TF_VAR_service_secrets = JSON.stringify(service);
  const failed = [];
  await assert.rejects(deployStage(input, operations(failed)), /Image service/);
  assert.deepEqual(failed, []);
});
