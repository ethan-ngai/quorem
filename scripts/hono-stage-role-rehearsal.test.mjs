import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { rehearseStageRole } from "./hono-stage-database-role.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
void test(
  "role rehearsal uses real migrations and rolls back accepted and rejected changes",
  { timeout: 120000 },
  async () => {
    await withDisposablePostgres(
      { prefix: "quorem-role-rehearsal", port: 55714, database: "quorem_hono_stage" },
      async ({ url, run }) => {
        for (const [owner, dir] of [
          ["product", "apps/api/migrations"],
          ["auth", "apps/auth/migrations"],
        ])
          await run(
            process.execPath,
            ["--experimental-strip-types", "packages/database/src/migrate.ts", owner, dir],
            { env: { ...process.env, DATABASE_URL: url } },
          );
        const client = new Client({ connectionString: url });
        await client.connect();
        const role = "quorem_stage_runtime_aaaaaaaaaaaa",
          password = "fixture-password-with-at-least-32-characters";
        try {
          const before = await client.query(
            "SELECT datacl FROM pg_database WHERE datname=current_database()",
          );
          const accepted = await rehearseStageRole(client, role, password);
          assert.equal(accepted.status, "accepted");
          assert.equal(accepted.phase, "boundary");
          assert.equal(accepted.code, null);
          assert.ok(Object.values(accepted.flags).every((v) => v === true));
          assert.equal(Object.keys(accepted.flags).length, 11);
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1", [role]))
              .rows[0].n,
            0,
          );
          assert.deepEqual(
            (await client.query("SELECT datacl FROM pg_database WHERE datname=current_database()"))
              .rows,
            before.rows,
          );
          await client.query(`CREATE ROLE ${role} NOLOGIN`);
          const rejected = await rehearseStageRole(client, role, password);
          assert.deepEqual(rejected, {
            status: "rejected",
            phase: "create_role",
            code: "42710",
            flags: {},
          });
          assert.equal(
            (await client.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role]))
              .rows[0].rolcanlogin,
            false,
          );
          assert.deepEqual(
            (await client.query("SELECT datacl FROM pg_database WHERE datname=current_database()"))
              .rows,
            before.rows,
          );
          assert.ok(!JSON.stringify(rejected).includes(password));
        } finally {
          await client.end();
        }
      },
    );
  },
);
