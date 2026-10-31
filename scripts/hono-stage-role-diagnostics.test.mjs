import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { deriveStageRole, provisionStageRole } from "./hono-stage-database-role.mjs";
import { diagnoseStageRole } from "./hono-stage-role-diagnostics.mjs";

void test(
  "read-only diagnostics distinguish absent and restricted runtime without credentials",
  { timeout: 60000 },
  async () => {
    await withDisposablePostgres(
      { prefix: "quorem-role-diagnostics", port: 55715, database: "quorem_hono_stage" },
      async ({ url, run }) => {
        for (const [owner, dir] of [
          ["product", "apps/api/migrations"],
          ["auth", "apps/auth/migrations"],
        ])
          await run(process.execPath, ["packages/database/src/migrate.ts", owner, dir], {
            env: { ...process.env, DATABASE_URL: url },
          });
        const { Client } = createRequire(
          new URL("../packages/database/package.json", import.meta.url),
        )("pg");
        const client = new Client({ connectionString: url });
        await client.connect();
        const role = deriveStageRole("a".repeat(40));
        try {
          await assert.rejects(diagnoseStageRole(client, "unsafe'role"), /Invalid runtime/);
          assert.equal((await diagnoseStageRole(client, role)).runtimeExists, false);
          const runtime = new URL(url);
          runtime.username = role;
          runtime.password = "fixture-only-runtime-password-at-least-32";
          await provisionStageRole(
            client,
            new Client({ connectionString: runtime.href }),
            role,
            runtime.password,
          );
          const report = await diagnoseStageRole(client, role);
          assert.equal(report.runtimeExists, true);
          assert.equal(report.runtime.database_connect, true);
          assert.equal(report.runtime.create_role, false);
          assert.equal(report.database.genesis_table, true);
          for (const secret of [url, runtime.password, role])
            assert.equal(JSON.stringify(report).includes(secret), false);
        } finally {
          await client.end();
        }
      },
    );
  },
);
