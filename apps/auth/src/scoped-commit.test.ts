import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { classifyDatabaseError, createNodePool, withNodeConnection } from "@quorem/database/core";
import { scopedDrizzleAdapter } from "./adapters/scoped-drizzle.ts";
import { migrateAuth } from "./migrations.ts";

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("scoped Better Auth transaction on disposable PostgreSQL", () => {
  it("reports an unknown commit without replay when its acknowledgment is lost", async () => {
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/quorem_hono_auth_native_test");
    expect(parsed.port).toBe("55438");
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(parsed.hostname);
    const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    let callbackCalls = 0;
    let capture!: (pid: unknown) => void;
    const ready = new Promise<unknown>((resolve) => {
      capture = resolve;
    });
    const id = crypto.randomUUID();
    try {
      await migrateAuth(pool);
      await pool.query(
        `CREATE FUNCTION quorem_auth.fixture_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(5); RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE CONSTRAINT TRIGGER fixture_commit_delay AFTER INSERT ON quorem_auth."user" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quorem_auth.fixture_commit_delay()`,
      );
      const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(pool, { lifetimeMs: 10000 }, async (scope) => {
          const pid = await scope.transaction(
            { statementTimeoutMs: 1000, lockTimeoutMs: 1000 },
            async (tx) => (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid,
          );
          capture(pid);
          return callback(scope);
        });
      const adapter = scopedDrizzleAdapter(run)({ secret: "fixture-secret-".repeat(4) });
      const pending = adapter.transaction(async (tx) => {
        callbackCalls++;
        await tx.create({
          model: "user",
          data: {
            id,
            name: "Fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          forceAllowId: true,
        });
      });
      const rejection = pending.then(
        () => {
          throw new Error("transaction unexpectedly succeeded");
        },
        (error) => error,
      );
      const pid = await Promise.race([
        ready,
        rejection.then((error) => {
          throw error;
        }),
      ]);
      let committing = false;
      for (let i = 0; i < 100; i++) {
        const row = (
          await pool.query(
            "SELECT state='active' AND upper(query)='COMMIT' AS committing FROM pg_stat_activity WHERE pid=$1",
            [pid],
          )
        ).rows[0];
        if (row?.committing) {
          committing = true;
          break;
        }
        await delay(10);
      }
      expect(committing).toBe(true);
      await pool.query("SELECT pg_terminate_backend($1)", [pid]);
      expect(classifyDatabaseError(await rejection)).toBe("unknown_commit");
      expect(callbackCalls).toBe(1);
      expect(
        (await pool.query('SELECT 1 FROM quorem_auth."user" WHERE id=$1', [id])).rowCount,
      ).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS fixture_commit_delay ON quorem_auth."user"');
      await pool.query("DROP FUNCTION IF EXISTS quorem_auth.fixture_commit_delay()");
      await pool.query('DELETE FROM quorem_auth."user" WHERE id=$1', [id]);
      await pool.end();
    }
  }, 15000);
});
