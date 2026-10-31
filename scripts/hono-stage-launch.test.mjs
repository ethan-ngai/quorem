import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import {
  bootstrapEnvironment,
  launchStage as actualLaunchStage,
  runStageCommand,
  StageCommandFailure,
} from "./hono-stage-launch.mjs";

import { validateStageIntent } from "./hono-stage-intent.mjs";

const launchStage = (env, options) => actualLaunchStage(env, { state: async () => {}, ...options });

const env = () => ({
  GITHUB_REF: "refs/heads/feat/hono-migration",
  GITHUB_SHA: "c".repeat(40),
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_ZONE_ID: "b".repeat(32),
  TF_STATE_BUCKET: "stage-state",
  CLOUDFLARE_API_TOKEN: "fixture-cloud-token",
  NEON_API_KEY: "fixture-neon-token",
  NEON_PROJECT_ID: "fixture-existing-project",
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
    [change("data.neon_branches.existing", ["create"])],
    [change("neon_database.stage", ["delete", "create"])],
    [change("neon_database.other", ["create"])],
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
    assert.deepEqual(calls, ["init", "state", "plan", "show"]);
  }
  const calls = [];
  await assert.rejects(
    launchStage(env(), {
      action: "stage",
      run: terraform([], createStageSecrets(), calls, [change("neon_database.stage", ["update"])]),
      freshness: async () => {},
    }),
    /unrelated or destructive/,
  );
  assert.deepEqual(calls, ["init", "state", "plan", "show"]);
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
      [
        change("neon_database.stage", ["create"]),
        change("terraform_data.stage_secrets", ["no-op"]),
      ],
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
  assert.deepEqual(calls, ["freshness", "init", "state", "plan", "show", "apply", "output"]);
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
    run: terraform(
      [change("data.neon_branches.existing", ["read"]), change("neon_database.stage", ["create"])],
      saved,
      calls,
    ),
    images: () => {
      throw new Error("unexpected publish");
    },
    activate: () => {
      throw new Error("unexpected activation");
    },
  });
  assert.deepEqual(calls, ["init", "state", "plan", "show"]);
  assert.deepEqual(result, {
    status: "planned",
    resources: [
      { address: "data.neon_branches.existing", actions: ["read"] },
      { address: "neon_database.stage", actions: ["create"] },
    ],
  });
  assert.equal(JSON.stringify(result).includes(saved.RECOVERY_CONTROL_SECRET), false);
});

void test("state privacy failure prevents all provisioning", async () => {
  const calls = [];
  await assert.rejects(
    launchStage(env(), {
      action: "stage",
      state: async () => {
        throw new Error("State unavailable");
      },
      run: () => {
        calls.push("provider");
      },
      freshness: async () => {
        calls.push("freshness");
      },
    }),
    /provider preflight failed/,
  );
  assert.deepEqual(calls, ["freshness"]);
});

void test("command diagnostics expose only fixed provider resource names", () => {
  const secret = "do-not-print-this-provider-payload";
  assert.throws(
    () =>
      runStageCommand("terraform", [], {}, () => ({
        status: 1,
        stderr: `with restapi_object.stage_branch: HTTP403 ${secret}`,
      })),
    (error) => {
      assert.ok(error instanceof StageCommandFailure);
      assert.equal(error.category, "provider permission");
      assert.deepEqual(error.resources, ["restapi_object.stage_branch"]);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    },
  );
});
void test("provider diagnostics separate errors and redact sensitive provider content", () => {
  const secret = "token-supersecret-123456";
  const url = "https://private.example.test/project/secret";
  const identifier = "53e9c435-0a20-4b53-925f-abaa618fead0";
  const error = new StageCommandFailure({
    stderr: `╷
│ Error: failed to create: HTTP status 403 {"code":10000,"message":"${secret} ${url} ${identifier}"}
│ with restapi_object.stage_branch,
╵
╷
│ Error: authentication failed: project-scoped token ${secret}
│ with neon_database.stage,
╵`,
  });
  assert.equal(error.category, "provider permission");
  assert.deepEqual(
    error.diagnostics.map(({ resources }) => resources),
    [["restapi_object.stage_branch"], ["neon_database.stage"]],
  );
  assert.deepEqual(error.diagnostics[0].statuses, [403]);
  assert.deepEqual(error.diagnostics[0].codes, [10000]);
  assert.equal(error.diagnostics[1].flags.project, true);
  assert.equal(error.diagnostics[1].flags.authentication, true);
  for (const value of [secret, url, identifier])
    assert.equal(JSON.stringify(error).includes(value), false);
  const unrelated = new StageCommandFailure({ stderr: "Error: invalid permission configuration" });
  assert.equal(unrelated.category, "configuration/provider");
});
void test("plain Terraform diagnostics keep separate resource failures apart", () => {
  const error = new StageCommandFailure({
    stderr: `Error: create service token: status code: 403 {"code":1010}
with restapi_object.stage_branch["case"],

Error: project-scoped key cannot create projects {"code":404}
with neon_database.stage,
`,
  });
  assert.equal(error.diagnostics.length, 2);
  assert.deepEqual(error.diagnostics[0].codes, [1010]);
  assert.deepEqual(error.diagnostics[1].codes, [404]);
  assert.deepEqual(error.diagnostics[1].resources, ["neon_database.stage"]);
  assert.equal(error.diagnostics[1].flags.project, true);
});
void test("REST diagnostic preserves scrubbed branch rejection details", () => {
  const error = new StageCommandFailure({
    stderr: `Error: Unexpected response code '400': {"code":"INVALID_REQUEST","message":"schema-only parent_id is required; opaque-secret-value https://private.example/secret"}
with restapi_object.stage_branch,`,
  });
  assert.deepEqual(error.diagnostics[0].statuses, [400]);
  assert.deepEqual(error.diagnostics[0].types, ["INVALID_REQUEST"]);
  assert.equal(error.diagnostics[0].flags.schemaOnly, true);
  assert.equal(error.diagnostics[0].flags.parent, true);
  assert.match(error.diagnostics[0].messages[0], /schema-only parent_id is required/);
  for (const value of ["opaque-secret-value", "private.example"])
    assert.equal(JSON.stringify(error).includes(value), false);
});

void test("branch messages redact environment credentials and other resources remain opaque", () => {
  const short = "key12345",
    long = `${short}-suffix`;
  const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
  const message = `schema-only requires a compute endpoint; ${short} ${long} ${pem} user@example.test postgres://user:pass@host/db`;
  assert.throws(
    () =>
      runStageCommand("terraform", [], { KEY: short, LONG: long }, () => ({
        status: 1,
        stderr: `Error: response code '400': ${JSON.stringify({ message })}\nwith restapi_object.stage_branch,\n\nError: ${JSON.stringify({ message: "generated database password" })}\nwith neon_role.stage,`,
      })),
    (error) => {
      const diagnostic = JSON.stringify(error.diagnostics);
      assert.match(error.diagnostics[0].messages[0], /schema-only requires a compute endpoint/);
      for (const value of [
        short,
        long,
        "suffix",
        "abc",
        "user@example",
        "postgres://",
        "generated database",
      ])
        assert.equal(diagnostic.includes(value), false, value);
      assert.deepEqual(error.diagnostics[1].messages, []);
      return true;
    },
  );
});
