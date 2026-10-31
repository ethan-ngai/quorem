import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { migrate } from "../packages/database/src/migrations.ts";
import { requireInitializableStageDatabase } from "./hono-stage-initialization.mjs";
const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
void test(
  "migration-only retry rejects data, drift, peers and live roles",
  { timeout: 180000 },
  async () => {
    await withDisposablePostgres(
      { prefix: "quorem-initialization", port: 55716, database: "quorem_hono_stage" },
      async ({ url }) => {
        const target = new URL(url);
        assert.equal(target.hostname, "127.0.0.1");
        assert.equal(target.port, "55716");
        assert.equal(target.pathname, "/quorem_hono_stage");
        const pool = new Pool({ connectionString: url, max: 2 });
        const env = {
          HONO_STAGE_DATABASE_URL:
            "postgres://fixture:fixture@stage.example/quorem_hono_stage?sslmode=verify-full",
          TF_VAR_database_host: "stage.example",
          TF_VAR_database_port: "5432",
        };
        const verify = () =>
          requireInitializableStageDatabase(env, () => new Pool({ connectionString: url, max: 1 }));
        try {
          await migrate(
            pool,
            "product",
            fileURLToPath(new URL("../apps/api/migrations", import.meta.url)),
          );
          await migrate(
            pool,
            "auth",
            fileURLToPath(new URL("../apps/auth/migrations", import.meta.url)),
          );
          await pool.end();
          assert.deepEqual(await verify(), { kind: "migrated-empty" });
          const peer = new Pool({ connectionString: url, max: 1 });
          await peer.query("SELECT 1");
          await assert.rejects(verify, /authority/g);
          await peer.end();
          const role = new Pool({ connectionString: url, max: 1 });
          await role.query("CREATE ROLE quorem_stage_runtime_fixture LOGIN");
          await role.end();
          await assert.rejects(verify, /authority/g);
          const cleanupRole = new Pool({ connectionString: url, max: 1 });
          await cleanupRole.query("DROP ROLE quorem_stage_runtime_fixture");
          await cleanupRole.end();
          const drift = new Pool({ connectionString: url, max: 1 });
          await drift.query("CREATE VIEW public.unexpected_stage_view AS SELECT 1");
          await drift.end();
          await assert.rejects(verify, /catalog/);
          const repair = new Pool({ connectionString: url, max: 1 });
          await repair.query("DROP VIEW public.unexpected_stage_view");
          await repair.query(
            "UPDATE runner_input_gc_state SET cursor=decode(repeat('00',32),'hex')",
          );
          await repair.end();
          await assert.rejects(verify, /data/g);
          const reset = new Pool({ connectionString: url, max: 1 });
          await reset.query("UPDATE runner_input_gc_state SET cursor=NULL");
          await reset.end();
          const admin = new Pool({ connectionString: url, max: 1 });
          try {
            await admin.query(
              `INSERT INTO quorem_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('fixture','fixture','fixture@example.test',true,now(),now())`,
            );
            await admin.end();
            await assert.rejects(verify, /data/g);
            const db = new Pool({ connectionString: url, max: 1 });
            await db.query('DELETE FROM quorem_auth."user"');
            await db.query(
              "UPDATE public.schema_migrations SET checksum='bad' WHERE name=(SELECT min(name) FROM public.schema_migrations)",
            );
            await db.end();
            await assert.rejects(verify, /history/g);
          } finally {
            await admin.end().catch(() => {});
          }
        } finally {
          await pool.end().catch(() => {});
        }
      },
    );
  },
);
