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

it.skipIf(!env.DATABASE_CHECK)(
  "public result pages reuse their request connection until EOF and isolate concurrent requests",
  async () => {
    const { withJudgingResponse } = await import("./judging-connections.ts");
    const open = async () => {
      let retained!: Parameters<Parameters<typeof withJudgingResponse>[2]>[0];
      const pid = () =>
        retained((scope) =>
          scope.withDatabase(
            async (db) =>
              (await db.execute<{ pid: number }>(sql`SELECT pg_backend_pid()::int AS pid`)).rows[0]
                .pid,
          ),
        );
      let first = 0;
      const response = await withJudgingResponse(
        env.DB.connectionString,
        AbortSignal.timeout(5000),
        async (run) => {
          retained = run;
          first = await pid();
          let page = 0;
          return new Response(
            new ReadableStream(
              {
                async pull(controller) {
                  if (page++ === 2) controller.close();
                  else controller.enqueue(new TextEncoder().encode(`${await pid()}\n`));
                },
              },
              { highWaterMark: 0 },
            ),
          );
        },
      );
      return { response, first, pid };
    };
    const [left, right] = await Promise.all([open(), open()]);
    expect(left.first).not.toBe(right.first);
    expect(await left.pid()).toBe(left.first);
    expect(await left.response.text()).toBe(`${left.first}\n${left.first}\n`);
    await expect(left.pid()).rejects.toThrow();
    expect(await right.response.text()).toBe(`${right.first}\n${right.first}\n`);
    await expect(right.pid()).rejects.toThrow();
  },
);

it.skipIf(!env.DATABASE_CHECK)(
  "public request connections close on body cancellation, failure, abort and handler failure",
  async () => {
    const { withJudgingResponse } = await import("./judging-connections.ts");
    for (const mode of ["cancel", "failure", "abort", "handler"] as const) {
      const controller = new AbortController();
      let retained!: Parameters<Parameters<typeof withJudgingResponse>[2]>[0];
      const request = withJudgingResponse(
        env.DB.connectionString,
        controller.signal,
        async (run) => {
          retained = run;
          await run((scope) => scope.withDatabase((db) => db.execute(sql`SELECT 1`)));
          if (mode === "handler") throw new Error("fixture handler failed");
          return new Response(
            new ReadableStream(
              {
                pull(stream) {
                  if (mode === "failure") stream.error(new Error("fixture page failed"));
                },
              },
              { highWaterMark: 0 },
            ),
          );
        },
      );
      if (mode === "handler") await expect(request).rejects.toThrow("fixture handler failed");
      else {
        const response = await request;
        if (mode === "cancel") await response.body!.cancel();
        else if (mode === "failure")
          await expect(response.text()).rejects.toThrow("fixture page failed");
        else {
          const body = response.text();
          controller.abort(new Error("fixture request aborted"));
          await expect(body).rejects.toThrow("fixture request aborted");
        }
      }
      await expect(retained((scope) => scope.withDatabase(async () => 1))).rejects.toThrow();
    }
  },
);
