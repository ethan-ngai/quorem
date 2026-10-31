/** @file profile-reads.ts @description Read-only catalog profiling without data output. @module cli */
import { performance } from "node:perf_hooks";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { problemQueries } from "../adapters/postgres/problems/queries/repository.ts";

type Captured = { text: string; values: unknown[] };
export async function profileReads(url: string): Promise<unknown> {
  const start = performance.now(),
    captured: Captured[] = [];
  const pool = createNodePool({
    connectionString: url,
    max: 1,
    connectionTimeoutMs: 10000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SET SESSION default_transaction_read_only=on");
      await client.query("SET SESSION statement_timeout=3000");
      await client.query("SET SESSION lock_timeout=1000");
      if (
        (await client.query("SHOW default_transaction_read_only")).rows[0]
          .default_transaction_read_only !== "on"
      )
        throw new Error("Read-only session required");
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: (...args: unknown[]) => unknown }).query = (
        ...args: unknown[]
      ) => {
        const query = args[0];
        const text =
          typeof query === "string"
            ? query
            : typeof query === "object" && query !== null && "text" in query
              ? String(query.text)
              : "";
        const values = Array.isArray(args[1])
          ? args[1]
          : typeof query === "object" &&
              query !== null &&
              "values" in query &&
              Array.isArray(query.values)
            ? query.values
            : [];
        if (/^\s*select\b/i.test(text) && !/^\s*select set_config\b/i.test(text))
          captured.push({ text, values });
        return original(...args);
      };
    } finally {
      client.release();
    }
    const connectionMs = performance.now() - start;
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
    const queries = problemQueries(run),
      filter = {
        query: "",
        difficulty: "",
        topic: "",
        company: "",
        sort: "title" as const,
        order: "asc" as const,
        library: "" as const,
        type: "" as const,
        sql: "" as const,
        page: 1,
        limit: 30,
      };
    let slug = "",
      id = "",
      catalogRows = 0;
    const calls: unknown[] = [],
      plans: unknown[] = [];
    const operations = [
      {
        name: "catalog",
        call: async () => {
          const raw = await queries.catalog(undefined, filter);
          const page = JSON.parse(raw) as { items: { slug: string; id: string }[] };
          catalogRows = page.items.length;
          slug = page.items[0]?.slug ?? "";
          id = page.items[0]?.id ?? "";
          return raw;
        },
      },
      { name: "problem_slug", call: () => queries.bySlug(undefined, slug) },
      { name: "problem_version", call: () => queries.byVersion(undefined, id) },
    ];
    for (const op of operations) {
      const samples: number[] = [];
      let statements: Captured[] = [];
      let bytes = 0;
      for (let sample = 0; sample < 5; sample++) {
        captured.length = 0;
        const began = performance.now();
        const result = await op.call();
        samples.push(performance.now() - began);
        bytes = Buffer.byteLength(result ?? "");
        if (sample === 0) statements = captured.slice();
      }
      const sorted = [...samples].sort((a, b) => a - b);
      calls.push({
        name: op.name,
        samples_ms: samples,
        median_ms: sorted[2],
        response_bytes: bytes,
      });
      const conn = await pool.connect();
      try {
        for (const [i, q] of statements.entries()) {
          const result = await conn.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.text}`,
            q.values,
          );
          const plan = result.rows[0]["QUERY PLAN"][0];
          plans.push({
            name: `${op.name}_sql_${i + 1}`,
            planning_ms: plan["Planning Time"],
            execution_ms: plan["Execution Time"],
            rows: plan.Plan["Actual Rows"],
            shared_hits: plan.Plan["Shared Hit Blocks"],
            shared_reads: plan.Plan["Shared Read Blocks"],
          });
        }
      } finally {
        conn.release();
      }
    }
    return {
      read_only: true,
      connection_ms: connectionMs,
      catalog_rows: catalogRows,
      calls,
      sql: plans,
    };
  } finally {
    await pool.end();
  }
}
if (import.meta.main)
  try {
    if (!process.env.DATABASE_URL) throw new Error("Missing database");
    process.stdout.write(`${JSON.stringify(await profileReads(process.env.DATABASE_URL))}\n`);
  } catch {
    console.error("Read-only SQL profiling failed; data withheld");
    process.exitCode = 1;
  }
