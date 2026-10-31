import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  baselineLegacy,
  migrate,
  type BaselineEvidence,
  type MigrationOwner,
} from "./migrations.ts";

const url = process.env.QUOREM_MIGRATION_CHECKSUM_TEST_URL;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
await test(
  "checksums, atomic retry and explicit audited legacy baseline",
  { skip: !url },
  async () => {
    const target = new URL(url!);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
    assert.equal(target.pathname, "/quorem_hono_migration_checksum_test");
    assert.equal(
      [...target.searchParams.keys()].filter((k) => ["host", "hostaddr", "service"].includes(k))
        .length,
      0,
    );
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const dir = await mkdtemp(join(tmpdir(), "quorem-checksum-"));
    const a = "CREATE TABLE public.checksum_first(id int);",
      b = "CREATE TABLE public.checksum_second(id int);";
    try {
      for (const owner of ["product", "auth"] as MigrationOwner[]) {
        await pool.query(
          "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
        );
        await writeFile(join(dir, "001_first.sql"), a);
        await writeFile(join(dir, "002_second.sql"), "SELECT nonexistent_checksum_function();");
        await assert.rejects(migrate(pool, owner, dir), /migration 002_second.sql failed/);
        assert.equal(
          (await pool.query("SELECT to_regclass('public.checksum_first') AS value")).rows[0].value,
          null,
        );
        await writeFile(join(dir, "002_second.sql"), b);
        await migrate(pool, owner, dir);
        await migrate(pool, owner, dir);
        const ledger =
          owner === "product" ? "public.schema_migrations" : "quorem_auth.schema_migrations";
        assert.deepEqual(
          (await pool.query(`SELECT checksum FROM ${ledger} ORDER BY name`)).rows.map(
            (r) => r.checksum,
          ),
          [hash(a), hash(b)],
        );
        await writeFile(join(dir, "001_first.sql"), a + " -- changed");
        await writeFile(join(dir, "003_not_run.sql"), "CREATE TABLE public.must_not_run(id int);");
        await assert.rejects(migrate(pool, owner, dir), /checksum mismatch/);
        assert.equal(
          (await pool.query("SELECT to_regclass('public.must_not_run') AS value")).rows[0].value,
          null,
        );
        await rm(join(dir, "003_not_run.sql"));
        await writeFile(join(dir, "001_first.sql"), a);
        await pool.query(
          `ALTER TABLE ${ledger} DROP COLUMN checksum, DROP COLUMN baseline_operation, DROP COLUMN baseline_operator, DROP COLUMN baseline_reason, DROP COLUMN baseline_artifact`,
        );
        await assert.rejects(migrate(pool, owner, dir), /requires an audited baseline/);
        const evidence: BaselineEvidence = {
          artifact: {
            owner,
            repository: "fixture/repo",
            workflow: ".github/workflows/deploy.yaml",
            runId: "123",
            commitSha: "a".repeat(40),
            artifactDigest: "b".repeat(64),
            files: { "001_first.sql": hash(a), "002_second.sql": hash(b) },
          },
          operationId: randomUUID(),
          operator: "fixture-operator",
          reason: "independent release record",
        };
        await assert.rejects(
          baselineLegacy(pool, owner, dir, evidence, async () => {
            throw new Error("unauthorized");
          }),
          /unauthorized/,
        );
        assert.equal(
          (
            await pool.query(
              `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='schema_migrations' AND column_name='checksum'`,
              [owner === "auth" ? "quorem_auth" : "public"],
            )
          ).rows[0].n,
          0,
        );
        await assert.rejects(
          baselineLegacy(
            pool,
            owner,
            dir,
            {
              ...evidence,
              artifact: {
                ...evidence.artifact,
                files: { ...evidence.artifact.files, "001_first.sql": "f".repeat(64) },
              },
            },
            async () => {},
          ),
          /artifact mismatch/,
        );
        let audited = false;
        await baselineLegacy(pool, owner, dir, evidence, async (client) => {
          await client.query("SELECT 1");
          audited = true;
        });
        assert.equal(audited, true);
        assert.equal(
          (
            await pool.query(
              `SELECT count(*)::int AS n FROM ${ledger} WHERE baseline_operation=$1 AND baseline_operator=$2 AND baseline_reason=$3 AND baseline_artifact IS NOT NULL`,
              [evidence.operationId, evidence.operator, evidence.reason],
            )
          ).rows[0].n,
          2,
        );
        await migrate(pool, owner, dir);
        await assert.rejects(
          baselineLegacy(pool, owner, dir, evidence, async () => {}),
          /entirely name-only/,
        );
      }
    } finally {
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
