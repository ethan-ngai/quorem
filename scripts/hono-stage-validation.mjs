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
        ...globSync("scripts/hono-stage*.test.mjs").sort(),
        "scripts/hono-remote-validation.test.mjs",
      ],
      { env: { ...process.env, QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL: url } },
    );
  },
);
