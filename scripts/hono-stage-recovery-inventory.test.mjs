import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { Client } = createRequire(new URL("../apps/api/package.json", import.meta.url))("pg");
const url = process.env.QUOREM_ATTEMPT_INVENTORY_TEST_URL;

void test(
  "inventory is atomic, immutable and retains old attempt authority",
  { skip: !url },
  async () => {
    const target = new URL(url);
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.port, "55599");
    assert.equal(target.pathname, "/quorem_hono_inventory_test");
    const db = new Client({ connectionString: url });
    await db.connect();
    try {
      await db.query(
        "CREATE TABLE execution_jobs (id uuid PRIMARY KEY, attempt_id uuid, lease_until timestamptz, finished boolean NOT NULL DEFAULT false)",
      );
      const job = randomUUID(),
        old = randomUUID(),
        first = randomUUID(),
        second = randomUUID();
      await db.query("INSERT INTO execution_jobs(id,attempt_id) VALUES($1,$2)", [job, old]);
      await db.query(
        await readFile(
          new URL("../apps/api/migrations/048_execution_reclaim_fence.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(
        await readFile(
          new URL("../apps/api/migrations/062_execution_attempt_inventory.sql", import.meta.url),
          "utf8",
        ),
      );
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM execution_attempt_inventory")).rows[0].n,
        0,
      );
      await db.query("BEGIN");
      await db.query("SELECT set_config('quorem.sandbox_scope','scope-one',true)");
      await db.query("UPDATE execution_jobs SET attempt_id=$1 WHERE id=$2", [first, job]);
      await db.query("ROLLBACK");
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM execution_attempt_inventory")).rows[0].n,
        0,
      );
      await db.query("BEGIN");
      await db.query("SELECT set_config('quorem.sandbox_scope','scope-one',true)");
      await db.query("UPDATE execution_jobs SET attempt_id=$1 WHERE id=$2", [first, job]);
      await db.query("COMMIT");
      await assert.rejects(
        db.query("UPDATE execution_jobs SET sandbox_scope='other' WHERE id=$1", [job]),
      );
      await db.query("BEGIN");
      await db.query("SELECT set_config('quorem.sandbox_scope','scope-one',true)");
      await db.query("UPDATE execution_jobs SET attempt_id=$1 WHERE id=$2", [second, job]);
      await db.query("COMMIT");
      await db.query("DELETE FROM execution_jobs WHERE id=$1", [job]);
      const rows = (
        await db.query(
          "SELECT attempt_id,job_id,sandbox_scope FROM execution_attempt_inventory ORDER BY attempt_id",
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.attempt_id).sort((a, b) => a.localeCompare(b)),
        [first, second].sort((a, b) => a.localeCompare(b)),
      );
      assert.ok(rows.every((r) => r.job_id === job && r.sandbox_scope === "scope-one"));
      await assert.rejects(db.query("DELETE FROM execution_attempt_inventory"));
      await assert.rejects(db.query("TRUNCATE execution_attempt_inventory"));
      await assert.rejects(db.query("UPDATE execution_attempt_inventory SET sandbox_scope='x'"));
    } finally {
      await db.end();
    }
  },
);
