import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readStageAttemptPage } from "./hono-stage-recovery-database.mjs";
import { fenceStageRuntime, stageRecoveryLockKey } from "./hono-stage-recovery-fence.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const raw = process.env.QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL;
if (raw) {
  const url = new URL(raw);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== "55598" ||
    url.pathname !== "/quorem_hono_stage" ||
    [...url.searchParams.keys()].some((v) => ["host", "hostaddr", "service"].includes(v))
  )
    throw new Error("Isolated stage recovery database required");
}
void test("rejects malformed scope, role, cursor and page bound", async () => {
  for (const input of [
    { scope: "other", role: "quorem_stage_runtime_aaaaaaaaaaaa" },
    { scope: `remote:${"a".repeat(64)}`, role: "postgres" },
    { scope: `remote:${"a".repeat(64)}`, role: "quorem_stage_runtime_aaaaaaaaaaaa", after: "bad" },
    { scope: `remote:${"a".repeat(64)}`, role: "quorem_stage_runtime_aaaaaaaaaaaa", limit: 101 },
  ])
    await assert.rejects(readStageAttemptPage({}, input), /Invalid/);
});
void test(
  "pages retained attempts only with a verified writer fence and consistent current jobs",
  { skip: !raw },
  async () => {
    const admin = new Client({ connectionString: raw }),
      role = `quorem_stage_runtime_${randomBytes(8).toString("hex")}`,
      scope = `remote:${"a".repeat(64)}`,
      other = `remote:${"b".repeat(64)}`;
    await admin.connect();
    let peer,
      prepared,
      createdJobs = false,
      createdInventory = false,
      roleCreated = false;
    try {
      const existing = await admin.query(
        "SELECT to_regclass('public.execution_jobs') AS jobs, to_regclass('public.execution_attempt_inventory') AS inventory",
      );
      assert.equal(existing.rows[0].jobs, null);
      assert.equal(existing.rows[0].inventory, null);
      await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
      roleCreated = true;
      await admin.query(
        "CREATE TABLE public.execution_jobs(id uuid PRIMARY KEY,attempt_id uuid,sandbox_scope text)",
      );
      createdJobs = true;
      await admin.query(
        "CREATE TABLE public.execution_attempt_inventory(attempt_id uuid PRIMARY KEY,job_id uuid NOT NULL,sandbox_scope text NOT NULL)",
      );
      createdInventory = true;
      const job = randomUUID(),
        entries = [randomUUID(), randomUUID(), randomUUID()].sort((a, b) => a.localeCompare(b));
      for (const attempt of entries)
        await admin.query("INSERT INTO execution_attempt_inventory VALUES($1,$2,$3)", [
          attempt,
          job,
          scope,
        ]);
      await admin.query("INSERT INTO execution_jobs VALUES($1,$2,$3)", [job, entries[1], scope]);
      await admin.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [stageRecoveryLockKey]);
      const assertHeld = async () => {
        peer = new Client({ connectionString: raw });
        await peer.connect();
        const locked = await peer.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
          [stageRecoveryLockKey],
        );
        assert.equal(locked.rows[0].acquired, false);
        await peer.end();
        peer = undefined;
      };
      await fenceStageRuntime(admin, role);
      await assertHeld();
      await readStageAttemptPage(admin, { scope, role, limit: 2 });
      await assertHeld();
      const unlock = await admin.query(
        "SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked",
        [stageRecoveryLockKey],
      );
      assert.equal(unlock.rows[0].unlocked, true);

      const first = await readStageAttemptPage(admin, { scope, role, limit: 2 });
      assert.deepEqual(
        first.attempts.map((row) => row.attemptId),
        entries.slice(0, 2),
      );
      assert.equal(first.next, entries[1]);
      const last = await readStageAttemptPage(admin, { scope, role, limit: 2, after: first.next });
      assert.deepEqual(
        last.attempts.map((row) => row.attemptId),
        entries.slice(2),
      );
      assert.equal(last.next, null);
      const unrelated = randomUUID();
      await admin.query("INSERT INTO execution_attempt_inventory VALUES($1,$2,$3)", [
        unrelated,
        job,
        other,
      ]);
      await assert.rejects(readStageAttemptPage(admin, { scope, role }), /authority/);
      await admin.query("DELETE FROM execution_attempt_inventory WHERE attempt_id=$1", [unrelated]);
      await admin.query("UPDATE execution_jobs SET sandbox_scope=$1 WHERE id=$2", [other, job]);
      await assert.rejects(readStageAttemptPage(admin, { scope, role }), /authority/);
      await admin.query("UPDATE execution_jobs SET sandbox_scope=$1,attempt_id=$2 WHERE id=$3", [
        scope,
        randomUUID(),
        job,
      ]);
      await assert.rejects(readStageAttemptPage(admin, { scope, role }), /authority/);
      await admin.query("UPDATE execution_jobs SET attempt_id=$1 WHERE id=$2", [entries[1], job]);
      await admin.query(`ALTER ROLE "${role}" LOGIN`);
      await assert.rejects(readStageAttemptPage(admin, { scope, role }), /login/);
      await admin.query(`ALTER ROLE "${role}" NOLOGIN`);
      peer = new Client({ connectionString: raw });
      await peer.connect();
      await assert.rejects(readStageAttemptPage(admin, { scope, role }), /sessions/);
      await peer.end();
      peer = undefined;
      prepared = new Client({ connectionString: raw });
      await prepared.connect();
      const xid = `quorem_inventory_${randomBytes(8).toString("hex")}`;
      await prepared.query("BEGIN");
      await prepared.query(`PREPARE TRANSACTION '${xid}'`);
      await prepared.end();
      prepared = undefined;
      try {
        await assert.rejects(readStageAttemptPage(admin, { scope, role }), /preconditions/);
      } finally {
        await admin.query(`ROLLBACK PREPARED '${xid}'`);
      }
    } finally {
      await peer?.end().catch(() => {});
      await prepared?.end().catch(() => {});
      if (createdInventory) await admin.query("DROP TABLE public.execution_attempt_inventory");
      if (createdJobs) await admin.query("DROP TABLE public.execution_jobs");
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
      await admin.end();
    }
  },
);
