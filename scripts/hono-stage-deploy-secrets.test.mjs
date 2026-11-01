import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uploadWorkerSecrets } from "./hono-stage-deploy-secrets.mjs";
const input = () =>
  JSON.parse(readFileSync(new URL("../deploy/hono/stage.fixture.json", import.meta.url)));
const outputs = () =>
  JSON.parse(
    readFileSync(new URL("../deploy/hono/terraform-outputs.fixture.json", import.meta.url)),
  );
const secrets = () => ({
  MATCH_INVITE_KEY: "ab".repeat(32),
  BETTER_AUTH_SECRET: "a".repeat(32),
  AUTH_INTERNAL_SECRET: "fixture",
  RUNNER_PEERS: JSON.stringify([{ secret: "r".repeat(32), scope: "fixture", resumable: true }]),
  VERIFICATION_SOURCE_CREDENTIAL: "a".repeat(64),
  VERIFICATION_SERVICE_CREDENTIAL: "b".repeat(64),
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
  CASE_OWNER_PRIVATE_KEY: "private-fixture",
});
void test("uploads validated Worker-only secrets on stdin", () => {
  let calls = 0;
  uploadWorkerSecrets(
    input(),
    outputs(),
    secrets(),
    { CASE_OWNER_PRIVATE_KEY: "private-fixture" },
    (cmd, args, options) => {
      calls++;
      assert.equal(cmd, "vp");
      assert.ok(args.includes("bulk"));
      assert.equal(options.env.CASE_OWNER_PRIVATE_KEY, undefined);
      const body = JSON.parse(options.input);
      assert.equal(body.CASE_OWNER_PRIVATE_KEY, undefined);
      assert.equal(body.CLOUDFLARE_ACCESS_CLIENT_SECRET, undefined);
      assert.equal(body.MATCH_INVITE_KEY, secrets().MATCH_INVITE_KEY);
      return { status: 0 };
    },
  );
  assert.equal(calls, 1);
});
void test("invalid preflight and provider failures never expose output", () => {
  let ran = false;
  assert.throws(() =>
    uploadWorkerSecrets(input(), outputs(), { ...secrets(), MATCH_INVITE_KEY: "bad" }, {}, () => {
      ran = true;
    }),
  );
  assert.equal(ran, false);
  assert.throws(
    () =>
      uploadWorkerSecrets(input(), outputs(), secrets(), {}, () => ({
        status: 1,
        stderr: "private-fixture",
      })),
    (error) => !String(error).includes("private-fixture"),
  );
});
