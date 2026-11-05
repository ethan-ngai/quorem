import { test } from "node:test";
import assert from "node:assert/strict";
import { judgingProfile } from "./judging-profile.ts";
import type { ConnectionScope } from "@quorem/database/core";

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

void test("connection timings retain awaited release and never record operation data", async () => {
  const profile = judgingProfile();
  let release!: () => void;
  const closing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = profile.connection(async (operation) => {
    const value = await operation({} as ConnectionScope);
    await closing;
    return value;
  });
  let completed = false;
  const result = run(async () => "private-result").then((value) => {
    completed = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  release();
  assert.equal(await result, "private-result");
  const raw = profile.header();
  assert.equal(raw.includes("private-result"), false);
  const value = JSON.parse(raw);
  for (const name of ["open", "work", "close"])
    assert.equal(value.metrics[`postgres.${name}`].calls, 1);
});
