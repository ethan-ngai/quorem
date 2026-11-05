import { test } from "node:test";
import assert from "node:assert/strict";
import { judgingProfile } from "./judging-profile.ts";

void test("private timing preserves receivers, failures and non-function properties", async () => {
  const profile = judgingProfile();
  const owner = profile.wrap(
    {
      scope: "private-value",
      async read() {
        return this.scope;
      },
      async fail() {
        throw new Error("private-error");
      },
    },
    "fixture",
  );
  assert.equal(owner.scope, "private-value");
  assert.equal(await owner.read(), "private-value");
  await assert.rejects(owner.fail(), /private-error/);
  const raw = profile.header();
  assert.equal(raw.includes("private-value"), false);
  assert.equal(raw.includes("private-error"), false);
  const value = JSON.parse(raw);
  assert.equal(value.metrics["fixture.read"].calls, 1);
  assert.equal(value.metrics["fixture.fail"].calls, 1);
  assert.ok(value.elapsedMs >= 0);
});
