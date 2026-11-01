/** Run profile cutover against migrated, isolated PostgreSQL and a local S3 fixture. */
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

await withDisposablePostgres(
  { prefix: "quorem-profile-cutover", port: 55707, database: "quorem_hono_profile_cutover_test" },
  async ({ url, run }) => {
    await run(
      process.execPath,
      [
        "--experimental-strip-types",
        "--test",
        "--test-concurrency=1",
        "scripts/hono-disposable-postgres.test.mjs",
        "apps/api/src/cli/profile-object-cutover.test.ts",
      ],
      { env: { ...process.env, QUOREM_PROFILE_CUTOVER_TEST_URL: url } },
    );
  },
);
