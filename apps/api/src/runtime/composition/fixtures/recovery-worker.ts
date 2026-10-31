/** Native workerd probe for the canonical request-scoped database client. */
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
interface Env {
  DB: { connectionString: string };
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      await withWorkerConnection(
        env.DB.connectionString,
        { connectionTimeoutMs: 2000, lifetimeMs: 30000 },
        (scope) =>
          scope.transaction({ statementTimeoutMs: 25000, lockTimeoutMs: 1000 }, async (tx) => {
            await tx.execute(
              new URL(request.url).pathname === "/hold" ? sql`select pg_sleep(20)` : sql`select 1`,
            );
          }),
      );
      return new Response("ok");
    } catch {
      return new Response("unavailable", { status: 503 });
    }
  },
};
