import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stageIntent, validateStageIntent } from "./hono-stage-intent.mjs";

const base = { GITHUB_REF: "refs/heads/feat/hono-migration", GITHUB_SHA: "a".repeat(40) };
void test("manual plans and stage require the exact authorized revision", () => {
  for (const action of ["plan", "stage"]) {
    const env = {
      ...base,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HONO_BOOTSTRAP_ACTION: action,
      HONO_RELEASE_SHA: base.GITHUB_SHA,
    };
    assert.equal(
      stageIntent(env, () => {
        throw new Error("unexpected file read");
      }),
      action,
    );
    assert.throws(() => stageIntent({ ...env, HONO_RELEASE_SHA: "b".repeat(40) }));
    assert.throws(() => stageIntent({ ...env, GITHUB_REF: "refs/heads/main" }));
    assert.throws(() => stageIntent({ ...env, GITHUB_SHA: "bad" }));
  }
});
void test("push intent accepts only a plan or stage with a UUID v4", () => {
  const env = { ...base, GITHUB_EVENT_NAME: "push" };
  for (const action of ["plan", "stage"]) {
    const input = { action, operation: randomUUID() };
    assert.equal(
      stageIntent(env, (path) => {
        assert.equal(path, "deploy/hono/stage-request.json");
        return JSON.stringify(input);
      }),
      action,
    );
    assert.throws(() => validateStageIntent(env, { ...input, extra: true }));
    assert.throws(() =>
      validateStageIntent(env, { ...input, operation: "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa" }),
    );
  }
  assert.throws(() => stageIntent(env, () => "invalid"), /intent file/);
  assert.throws(
    () =>
      stageIntent({ ...env, GITHUB_REF: "refs/heads/main" }, () => {
        throw new Error("should not read");
      }),
    /migration release/,
  );
  assert.throws(() =>
    validateStageIntent(
      { ...env, GITHUB_EVENT_NAME: "pull_request" },
      { action: "stage", operation: randomUUID() },
    ),
  );
});
