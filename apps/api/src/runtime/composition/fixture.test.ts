/** @file fixture.test.ts @description Disposable runtime bootstrap and lock coverage. @module runtime */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNodePool } from "@quorem/database/core";
import { bootstrapRuntimeFixture } from "./fixture.ts";
import { assertRuntimeTestDatabase } from "./test-database.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
if (!url) throw new Error("Disposable runtime database required");
assertRuntimeTestDatabase(url);
void test("runtime fixture seeds both ledgers, rejects overlap, and cleans up", async () => {
  const cleanup = await bootstrapRuntimeFixture(url!);
  const pool = createNodePool({
    connectionString: url!,
    max: 1,
    connectionTimeoutMs: 3000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  try {
    await assert.rejects(bootstrapRuntimeFixture(url!), /already in use/);
    const row = (
      await pool.query(
        `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS product, to_regclass('quorem_auth.schema_migrations') IS NOT NULL AS auth, EXISTS(SELECT 1 FROM runner_version_inputs WHERE version_id='e91ec728-4597-5dfb-9d19-7c4ba17138b7' AND sealed) AS indexed, EXISTS(SELECT 1 FROM access_audit WHERE operation_id='bootstrap:operator' AND user_id='runtime-fixture-operator') AS operator`,
      )
    ).rows[0];
    assert.deepEqual(row, { product: true, auth: true, indexed: true, operator: true });
  } finally {
    await pool.end();
    await cleanup();
  }
  const check = createNodePool({
    connectionString: url!,
    max: 1,
    connectionTimeoutMs: 3000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  try {
    assert.deepEqual(
      (
        await check.query(
          "SELECT to_regclass('public.schema_migrations') IS NULL AS product, to_regnamespace('quorem_auth') IS NULL AS auth",
        )
      ).rows[0],
      { product: true, auth: true },
    );
  } finally {
    await check.end();
  }
});
