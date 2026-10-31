import { assertRuntimeTestDatabase } from "./test-database.ts";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createNodePool } from "@quorem/database/core";
import { startNodeRuntime } from "../node.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
it.skipIf(!url)("releases all opened PostgreSQL sessions after startup failure", async () => {
  assertRuntimeTestDatabase(url!);
  const pool = createNodePool({
    connectionString: url!,
    max: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const applicationName = `lifecycle-${randomUUID()}`;
  const tagged = new URL(url!);
  tagged.searchParams.set("application_name", applicationName);
  const taggedURL = tagged.toString();
  const count = async () =>
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1",
          [applicationName],
        )
      ).rows[0].n,
    );
  const waitForNoSessions = async () => {
    for (let i = 0; i < 80 && (await count()) !== 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await count()).toBe(0);
  };
  try {
    const probe = createNodePool({
      connectionString: taggedURL,
      max: 1,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    try {
      await probe.query("SELECT 1");
      expect(await count()).toBe(1);
    } finally {
      await probe.end();
    }
    await waitForNoSessions();
    await expect(
      startNodeRuntime({
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://127.0.0.1:8765",
        AUTH_DATABASE_URL: taggedURL,
        DATABASE_URL: taggedURL,
        QUOREM_DATABASE_LISTEN_URL: taggedURL,
        BETTER_AUTH_SECRET: "local-runtime-fixture-secret-32-characters",
        AUTH_INTERNAL_SECRET: "local-test-internal",
        QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
        MATCH_INVITE_KEY: "ab".repeat(32),
        EXECUTION_WAKE_PROVIDER: "sqs",
        EXECUTION_NODE_QUEUE_MODE: "disabled",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
        PORT: "0",
        IDENTITY_MODE: "invalid",
      }),
    ).rejects.toThrow("Invalid identity mode");
    await waitForNoSessions();
  } finally {
    await pool.end();
  }
});
