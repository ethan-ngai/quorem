/** Local deployment contracts; owns only its disposable PostgreSQL container. */
import { globSync } from "node:fs";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

await withDisposablePostgres(
  { prefix: "quorem-stage-contracts", port: 55598, database: "quorem_hono_stage" },
  async ({ url, run }) => {
    // Recovery cases terminate other sessions; files share this fixture sequentially.
    await run(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        ...globSync("scripts/hono-stage*.test.mjs")
          .filter(
            (file) =>
              ![
                "scripts/hono-stage-recovery-inventory.test.mjs",
                "scripts/hono-stage-database-role.test.mjs",
              ].includes(file),
          )
          .sort(),
        "scripts/hono-remote-validation.test.mjs",
      ],
      { env: { ...process.env, QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL: url } },
    );
    for (const [owner, dir] of [
      ["product", "apps/api/migrations"],
      ["auth", "apps/auth/migrations"],
    ]) {
      await run("vp", ["exec", "node", "packages/database/src/migrate.ts", owner, dir], {
        env: { ...process.env, DATABASE_URL: url },
      });
    }
    await run(process.execPath, ["--test", "scripts/hono-stage-database-role.test.mjs"], {
      env: { ...process.env, QUOREM_STAGE_ROLE_TEST_URL: url },
    });
  },
);

await withDisposablePostgres(
  { prefix: "quorem-stage-inventory", port: 55599, database: "quorem_hono_inventory_test" },
  async ({ url, run }) => {
    await run(process.execPath, ["--test", "scripts/hono-stage-recovery-inventory.test.mjs"], {
      env: { ...process.env, QUOREM_ATTEMPT_INVENTORY_TEST_URL: url },
    });
  },
);
