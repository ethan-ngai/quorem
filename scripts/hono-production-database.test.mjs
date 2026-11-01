import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { migrate } from "../packages/database/src/migrations.ts";
import { configureRestrictedRole } from "./hono-stage-database-role.mjs";
import { transitionProductionDatabase } from "./hono-production-database.mjs";
const { Client, Pool } = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
)("pg");
const password = "fixture-only-runtime-password-abcdefghijklmnopqrstuvwxyz";
void test("production transition fails closed on invalid inputs", async () => {
  await assert.rejects(
    transitionProductionDatabase({
      databaseURL: "postgres://x:y@localhost/neondb?sslmode=disable",
      authOrigin: "https://example.com",
      productionRunId: "1",
      runtimeRole: "quorem_hono_runtime_123456789abc",
      runtimePassword: password,
      assertLegacyStopped: async () => {},
    }),
    /configuration/,
  );
});
void test(
  "real migrated database fences prepared work and enforces runtime role grants",
  { timeout: 120000 },
  async () => {
    await withDisposablePostgres(
      { prefix: "quorem-production-role", port: 55713, database: "quorem_hono_transition_test" },
      async ({ url }) => {
        const admin = new Client({ connectionString: url });
        await admin.connect();
        await admin.query("CREATE DATABASE neondb");
        const target = new URL(url);
        target.pathname = "/neondb";
        let pool = new Pool({ connectionString: target.href, max: 2 });
        const role = `quorem_hono_runtime_${"a".repeat(12)}`;
        try {
          await migrate(pool, "product", "apps/api/migrations");
          await migrate(pool, "auth", "apps/auth/migrations");
          const worker = await pool.connect();
          await worker.query("BEGIN");
          await worker.query("SELECT 1");
          await worker.query("PREPARE TRANSACTION 'fixture-transition'");
          worker.release();
          let called = false;
          await assert.rejects(
            transitionProductionDatabase(
              {
                databaseURL: target.href,
                authOrigin: "https://example.com",
                productionRunId: "1",
                runtimeRole: role,
                runtimePassword: password,
                assertLegacyStopped: async () => {
                  called = true;
                },
              },
              { backfillProblemVersions: async () => ({ complete: true }) },
            ),
            /quiescent/,
          );
          assert.equal(called, false);
          await pool.query("ROLLBACK PREPARED 'fixture-transition'");
          await assert.rejects(
            transitionProductionDatabase(
              {
                databaseURL: target.href,
                authOrigin: "https://example.com",
                productionRunId: "1",
                runtimeRole: role,
                runtimePassword: password,
                assertLegacyStopped: async () => false,
              },
              { backfillProblemVersions: async () => ({ complete: true }) },
            ),
            /shutdown/,
          );
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const flags = await configureRestrictedRole(client, role, password, () => {}, {
              databaseName: "neondb",
              isolateConnections: false,
            });
            assert.ok(Object.values(flags).every(Boolean));
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
          const credentials = new URL(target);
          credentials.username = role;
          credentials.password = password;
          const runtime = new Client({ connectionString: credentials.href });
          await runtime.connect();
          try {
            assert.equal((await runtime.query("SELECT current_user AS name")).rows[0].name, role);
            await assert.rejects(runtime.query("SELECT * FROM public.schema_migrations"));
            await assert.rejects(runtime.query("SELECT * FROM public.execution_attempt_inventory"));
            assert.equal(
              (await runtime.query("SELECT count(*)::int AS n FROM public.problems")).rows[0].n,
              0,
            );
          } finally {
            await runtime.end();
          }
          await pool.query(`DROP OWNED BY "${role}"`);
          await pool.query(`DROP ROLE "${role}"`);
          const actor = "33333333-3333-4333-8333-333333333333",
            subject = "fixture-subject";
          await pool.query(
            `INSERT INTO public.users(id,display_name,role) VALUES($1,'Fixture','admin')`,
            [actor],
          );
          await pool.query(
            `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Fixture','fixture@example.test',true,now(),now())`,
            [subject],
          );
          await pool.query(
            "INSERT INTO public.identity_bindings(issuer,subject,user_id) VALUES('https://example.com',$1,$2)",
            [subject, actor],
          );
          await pool.query(
            "INSERT INTO public.access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator',$1,$1,'operator.bootstrap',$2,'fixture')",
            [actor, subject],
          );
          await pool.end();
          const options = {
            databaseURL: target.href,
            authOrigin: "https://example.com",
            productionRunId: "1",
            runtimeRole: role,
            runtimePassword: password,
            assertLegacyStopped: async () => true,
          };
          const dependencies = {
            backfillProblemVersions: async () => ({ complete: true, dryRun: false, completed: 0 }),
          };
          const first = await transitionProductionDatabase(options, dependencies);
          const second = await transitionProductionDatabase(options, dependencies);
          assert.equal(first.operationId, second.operationId);
          assert.equal(new URL(first.runtimeURL).username, role);
          pool = new Pool({ connectionString: target.href, max: 2 });
          await pool.query(`DROP OWNED BY "${role}"`);
          await pool.query(`DROP ROLE "${role}"`);
        } finally {
          await pool.end();
          await admin.query("DROP DATABASE neondb WITH (FORCE)");
          await admin.end();
        }
      },
    );
  },
);
