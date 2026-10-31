/** @file worker-fixture.ts @description Native catalog PostgreSQL integration fixture. @module problems */
import { sql } from "drizzle-orm";
import {
  withWorkerConnection,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import { developmentIdentity } from "../../identity/repository.ts";
import { createApp } from "../../../../app.ts";
import { problemRoutes } from "../../../../modules/problems/routes.ts";
import { problemQueries, type ReadScope } from "./repository.ts";

interface Env {
  CATALOG_TEST_DATABASE_URL: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(env.CATALOG_TEST_DATABASE_URL);
    if (
      url.port !== "55441" ||
      url.pathname !== "/quorem_hono_catalog_test" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      return new Response("invalid fixture database", { status: 500 });
    url.username = "quorem_catalog_worker_read";
    let queries = 0,
      pid = 0,
      identityDone = false,
      readAfterIdentity = false;
    const options = { connectionTimeoutMs: 1000, lifetimeMs: 4000 };
    const run: ReadScope = <T>(read: (scope: ConnectionScope) => Promise<T>) =>
      withWorkerConnection(url.toString(), options, async (scope) =>
        read({
          transaction: (opts, action) =>
            scope.transaction(opts, async (tx) => {
              readAfterIdentity = identityDone;
              const value = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))
                .rows[0];
              pid = value.pid;
              const tracked = new Proxy(tx, {
                get(target, key, receiver) {
                  const member = Reflect.get(target, key, receiver);
                  if (key !== "execute" || typeof member !== "function") return member;
                  return (...args: unknown[]) => {
                    queries++;
                    return Reflect.apply(member, target, args);
                  };
                },
              }) as Transaction;
              return action(tracked);
            }),
        }),
      );
    const routes = problemRoutes({
      queries: problemQueries(run),
      identify: async () => {
        const principal = await withWorkerConnection(url.toString(), options, (scope) =>
          developmentIdentity(scope, "quorem-catalog-worker-actor"),
        );
        identityDone = true;
        return principal;
      },
    });
    const app = createApp({ allowedOrigins: [], requestId: () => "workerd-test" }).route(
      "/",
      routes,
    );
    const result = await app.fetch(request);
    const headers = new Headers(result.headers);
    headers.set("X-Fixture-Queries", String(queries));
    headers.set("X-Fixture-Pid", String(pid));
    headers.set("X-Fixture-Identity-First", String(readAfterIdentity));
    return new Response(result.body, { status: result.status, headers });
  },
};
