import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlan, validateStageRequest } from "./hono-stage-deploy.mjs";
const env = () => ({
  HONO_STAGE_ACTION: "plan",
  GITHUB_REF: "refs/heads/feat/hono-migration",
  HONO_RELEASE_SHA: "a".repeat(40),
  GITHUB_SHA: "a".repeat(40),
  TF_VAR_database_name: "quorem_hono_stage",
  TF_VAR_case_namespace_id: "0".repeat(64),
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
void test("plans only isolated stage stacks with locking and no saved plan", () => {
  const calls = [];
  runPlan(env(), (cmd, args, options) => {
    assert.match(options.env.TF_VAR_database_user, /^quorem_stage_runtime_[0-9a-f]{32}$/);
    calls.push([cmd, args]);
    return { status: 0, stdout: "No changes.", stderr: "" };
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(([, args]) => args[1]),
    ["init", "plan", "init", "plan"],
  );
  assert.ok(calls.every(([cmd]) => cmd === "terraform"));
  assert.ok(calls.every(([, args]) => !args.some((arg) => arg.startsWith("-out"))));
  assert.ok(calls[0][1].includes("-backend-config=key=hono-stage/terraform.tfstate"));
  assert.ok(calls[2][1].includes("-backend-config=key=hono-services/terraform.tfstate"));
});
void test("rejects branch, revision, database and queue drift before executing", () => {
  for (const patch of [
    { GITHUB_REF: "refs/heads/dev" },
    { HONO_RELEASE_SHA: "f".repeat(40) },
    { TF_VAR_database_name: "quorem" },
    { TF_VAR_case_namespace_id: "" },
    { TF_VAR_worker_name: "quorem" },
    { TF_VAR_enable_queue_consumer: "true" },
    { TF_VAR_access_token_ids: JSON.stringify({ drain: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) },
    { TF_VAR_runner_image: "registry.cloudflare.com/example:latest" },
  ])
    assert.throws(() => validateStageRequest({ ...env(), ...patch }));
  let executed = false;
  assert.throws(
    () =>
      runPlan({ ...env(), HONO_STAGE_ACTION: "stage" }, () => {
        executed = true;
      }),
    /not yet enabled/,
  );
  assert.equal(executed, false);
});
void test("withholds arbitrary provider errors and secret output", () => {
  const marker = "fixture-secret-not-for-output";
  assert.throws(
    () => runPlan(env(), () => ({ status: 1, stdout: marker, stderr: marker })),
    (error) => !String(error).includes(marker),
  );
});

void test("summarizes keyed resource actions without exposing provider values", () => {
  const result = runPlan(env(), (_, args) => ({
    status: 0,
    stdout:
      args[1] === "plan"
        ? '  # cloudflare_workers_route.service["case"] will be created\n  secret fixture-secret\nPlan: 1 to add, 0 to change, 0 to destroy.\n'
        : "",
  }));
  assert.deepEqual(result[0].actions, ['cloudflare_workers_route.service["case"] will be created']);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});
