import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";
import { migrate } from "@quorem/database/migrations";
import { migrationBaseline, runMigrationBaseline } from "./migration-baseline.ts";

const url = process.env.QUOREM_MIGRATION_BASELINE_TEST_URL;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
void test("standalone apply cannot bypass the missing authoritative fence", async () => {
  await assert.rejects(migrationBaseline(["--apply"]), /fence/);
});
void test(
  "audited baseline verifies GitHub fixture and transactionally fences legacy checksums",
  { skip: !url, timeout: 60000 },
  async () => {
    const parsed = new URL(url!);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.port, "55707");
    assert.equal(parsed.pathname, "/quorem_hono_migration_baseline_test");
    assert.equal(parsed.search, "?sslmode=disable");
    assert.equal(parsed.hash, "");
    const pool = new pg.Pool({ connectionString: url, max: 4 }),
      lock = await pool.connect();
    const operator = randomUUID(),
      subject = randomUUID(),
      operationId = randomUUID(),
      runId = "1234567",
      commit = "a".repeat(40),
      prefix = "repos/ethan-ngai/quorem";
    let held = false;
    const request = async (path: string): Promise<unknown> => {
      if (path === `${prefix}/actions/runs/${runId}`)
        return {
          id: Number(runId),
          path: ".github/workflows/deploy.yaml",
          name: "Deploy production",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          event: "push",
          head_sha: commit,
          run_attempt: 1,
          repository: { full_name: "ethan-ngai/quorem" },
          head_repository: { full_name: "ethan-ngai/quorem" },
        };
      if (path === `${prefix}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=1`)
        return {
          total_count: 1,
          jobs: [
            {
              name: "deploy",
              run_id: Number(runId),
              status: "completed",
              conclusion: "success",
              steps: [
                {
                  name: "Run actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
                  number: 1,
                  status: "completed",
                  conclusion: "success",
                },
                {
                  name: "Migrate and bootstrap operator",
                  number: 2,
                  status: "completed",
                  conclusion: "success",
                },
              ],
            },
          ],
        };
      const start = `${prefix}/contents/`,
        end = `?ref=${commit}`;
      assert.ok(path.startsWith(start) && path.endsWith(end));
      const name = path.slice(start.length, -end.length),
        bytes = await readFile(
          resolve(
            root,
            name === "apps/auth/src/migrations.ts"
              ? "apps/api/src/cli/fixtures/deployed-auth-migrations.ts.txt"
              : name,
          ),
        );
      return {
        type: "file",
        path: name,
        size: bytes.length,
        encoding: "base64",
        content: bytes.toString("base64"),
        sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      };
    };
    try {
      assert.equal(
        (await lock.query("SELECT current_database() AS name")).rows[0].name,
        "quorem_hono_migration_baseline_test",
      );
      held = (await lock.query("SELECT pg_try_advisory_lock(740039,1) AS locked")).rows[0].locked;
      assert.ok(held);
      await lock.query(
        "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
      );
      await migrate(pool, "product", resolve(root, "apps/api/migrations"));
      await migrate(pool, "auth", resolve(root, "apps/auth/migrations"));
      await pool.query("INSERT INTO users(id,display_name,role) VALUES($1,'Operator','admin')", [
        operator,
      ]);
      await pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Operator','operator@fixture.test',true,now(),now())`,
        [subject],
      );
      await pool.query(
        "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://auth.example',$1,$2)",
        [subject, operator],
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator',$1,$1,'operator.bootstrap',$2,'fixture')",
        [operator, subject],
      );
      await pool.query(
        "ALTER TABLE public.schema_migrations DROP COLUMN checksum, DROP COLUMN baseline_operation, DROP COLUMN baseline_operator, DROP COLUMN baseline_reason, DROP COLUMN baseline_artifact",
      );
      const options = {
        pool,
        owner: "product" as const,
        runId,
        operator,
        issuer: "https://auth.example",
        operationId,
        reason: "fixture",
        apply: false,
      };
      const audit = await runMigrationBaseline(options, { request });
      assert.equal(audit.applied, false);
      assert.ok(audit.migrationCount > 1);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' AND column_name='checksum'",
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(runMigrationBaseline({ ...options, apply: true }, { request }), /fence/);
      await assert.rejects(
        runMigrationBaseline(
          { ...options, apply: true },
          {
            request,
            fence: async () => {
              throw new Error("fence denied");
            },
          },
        ),
        /fence denied/,
      );
      assert.equal(
        (
          await pool.query("SELECT count(*)::int AS n FROM access_audit WHERE operation_id=$1", [
            operationId,
          ])
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        runMigrationBaseline(
          { ...options, apply: true },
          {
            request,
            fence: async (client) => {
              await client.query("UPDATE users SET disabled=true WHERE id=$1", [operator]);
            },
          },
        ),
        /operator/i,
      );
      assert.equal(
        (await pool.query("SELECT disabled FROM users WHERE id=$1", [operator])).rows[0].disabled,
        false,
      );
      const fence = async (client: pg.PoolClient) => {
        await client.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [operator]);
      };
      assert.equal(
        (await runMigrationBaseline({ ...options, apply: true }, { request, fence })).applied,
        true,
      );
      assert.equal(
        (await runMigrationBaseline({ ...options, apply: true }, { request, fence })).applied,
        true,
      );
      assert.equal(
        (
          await pool.query("SELECT count(*)::int AS n FROM access_audit WHERE operation_id=$1", [
            operationId,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM public.schema_migrations WHERE checksum IS NULL",
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        runMigrationBaseline({ ...options, apply: true, reason: "changed" }, { request, fence }),
        /conflict/,
      );
      await pool.query(
        "ALTER TABLE quorem_auth.schema_migrations DROP COLUMN checksum, DROP COLUMN baseline_operation, DROP COLUMN baseline_operator, DROP COLUMN baseline_reason, DROP COLUMN baseline_artifact",
      );
      const collision = randomUUID();
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'other','other','fixture')",
        [collision, operator],
      );
      const auth = { ...options, owner: "auth" as const, operationId: collision };
      assert.equal((await runMigrationBaseline(auth, { request })).applied, false);
      await assert.rejects(
        runMigrationBaseline({ ...auth, apply: true }, { request, fence }),
        /Operation ID already used/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='quorem_auth' AND table_name='schema_migrations' AND column_name='checksum'",
          )
        ).rows[0].n,
        0,
      );
      const authorized = { ...auth, operationId: randomUUID(), apply: true };
      assert.equal((await runMigrationBaseline(authorized, { request, fence })).applied, true);
      assert.equal((await runMigrationBaseline(authorized, { request, fence })).applied, true);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM quorem_auth.schema_migrations WHERE checksum IS NULL",
          )
        ).rows[0].n,
        0,
      );
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [operator]);
      await assert.rejects(runMigrationBaseline(options, { request }), /operator/i);
    } finally {
      if (held) {
        await lock.query(
          "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
        );
        await lock.query("SELECT pg_advisory_unlock(740039,1)");
      }
      lock.release();
      await pool.end();
    }
  },
);
