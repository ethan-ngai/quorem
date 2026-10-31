import { expect, it } from "vitest";
import { createNodePool } from "@quorem/database/core";
import { startNodeRuntime } from "../node.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
it.skipIf(!url)("releases all opened PostgreSQL sessions after startup failure", async () => {
  const parsed = new URL(url!);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55575",
    "/quorem_hono_runtime_test",
  ]);
  const pool = createNodePool({
    connectionString: url!,
    max: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const count = async () =>
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
        )
      ).rows[0].n,
    );
  try {
    const before = await count();
    await expect(
      startNodeRuntime({
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://127.0.0.1:8765",
        AUTH_DATABASE_URL: url!,
        DATABASE_URL: url!,
        QUOREM_DATABASE_LISTEN_URL: url!,
        BETTER_AUTH_SECRET: "local-runtime-fixture-secret-32-characters",
        AUTH_INTERNAL_SECRET: "local-test-internal",
        QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
        MATCH_INVITE_KEY: "ab".repeat(32),
        EXECUTION_WAKE_PROVIDER: "sqs",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
        PORT: "0",
        IDENTITY_MODE: "invalid",
      }),
    ).rejects.toThrow("Invalid identity mode");
    expect(await count()).toBe(before);
  } finally {
    await pool.end();
  }
});
