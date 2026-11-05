/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withJudgingConnections } from "./judging-connections.ts";
const env = bindings as unknown as { DB: { connectionString: string }; DATABASE_CHECK: string };

it.skipIf(!env.DATABASE_CHECK)(
  "private invocations reuse at most four connections and close their ownership",
  async () => {
    expect(new URL(env.DATABASE_CHECK).pathname).toBe("/quorem_hono_runtime_test");
    const retained = await withJudgingConnections(
      env.DB.connectionString,
      AbortSignal.timeout(5000),
      async (run) => {
        const read = () =>
          run((scope) =>
            scope.withDatabase(
              async (db) =>
                (
                  await db.execute<{ pid: number }>(
                    sql`SELECT pg_backend_pid()::int AS pid,pg_sleep(0.01)`,
                  )
                ).rows[0].pid,
            ),
          );
        expect(new Set(await Promise.all(Array.from({ length: 8 }, read))).size).toBe(4);
        expect(await read()).toBe(await read());
        return run;
      },
    );
    await expect(retained((scope) => scope.withDatabase(async () => 1))).rejects.toThrow();
  },
);
