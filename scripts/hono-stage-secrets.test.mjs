import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSecrets } from "./hono-stage-secrets.mjs";
const env = () => ({
  RUNNER_PEERS: JSON.stringify([{ secret: "r".repeat(32), scope: "fixture", resumable: true }]),
  VERIFICATION_SOURCE_CREDENTIAL: "a".repeat(64),
  VERIFICATION_SERVICE_CREDENTIAL: "b".repeat(64),
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
});
void test("private credentials must be distinct and well formed", () => {
  assert.doesNotThrow(() => checkSecrets(env()));
  assert.throws(
    () => checkSecrets({ ...env(), EXECUTION_DRAIN_SECRET: "a".repeat(64) }),
    /distinct/,
  );
  assert.throws(
    () => checkSecrets({ ...env(), VERIFICATION_SERVICE_CREDENTIAL: "bad" }),
    /Invalid/,
  );
  assert.throws(() => checkSecrets({ ...env(), EXECUTION_DRAIN_SECRET: "short" }), /Invalid/);
  assert.throws(() => checkSecrets({ ...env(), RUNNER_PEERS: "[" }), /Invalid/);
  assert.throws(() => checkSecrets({ ...env(), PROFILE_IMAGE_SERVICE_TOKEN: "short" }), /Invalid/);
  assert.throws(
    () => checkSecrets({ ...env(), PROFILE_IMAGE_SERVICE_TOKEN: "d".repeat(32) }),
    /distinct/,
  );
});
