/** Required native SQL flows on an owned disposable database. */
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

await withDisposablePostgres(
  { prefix: "quorem-sql-runtime", port: 55701, database: "quorem_hono_runtime_test" },
  async ({ url, run }) =>
    run(
      "vp",
      [
        "-C",
        "apps/api",
        "exec",
        "node",
        "--test",
        "src/runtime/composition/sql-browser-http.test.ts",
      ],
      {
        env: {
          ...process.env,
          QUOREM_BROWSER_FIXTURE_DATABASE_URL: url,
          QUOREM_TEST_DOCKER_SOCKET: "/var/run/docker.sock",
          WRANGLER_SEND_METRICS: "false",
        },
      },
    ),
);
