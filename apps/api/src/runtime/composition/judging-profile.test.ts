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
  assert.equal(value.failures[0].operation, "fixture.fail");
  assert.equal(value.failures[0].databaseKind, "other");
  assert.match(value.failures[0].fingerprint, /^[0-9a-f]{64}$/);
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

void test("correlates a wrapped database failure with its attempt", async () => {
  const profile = judgingProfile();
  const attemptId = crypto.randomUUID();
  const owner = profile.wrap(
    {
      async finalize(_job: { attemptId: string }) {
        throw new Error("private SQL", { cause: { code: "55P03" } });
      },
    },
    "repository",
  );
  await assert.rejects(owner.finalize({ attemptId }));
  const raw = profile.header();
  assert.equal(raw.includes("private SQL"), false);
  const [failure] = JSON.parse(raw).failures;
  assert.equal(failure.operation, "repository.finalize");
  assert.equal(failure.databaseKind, "lock_timeout");
  assert.equal(failure.attemptId, attemptId);
});
