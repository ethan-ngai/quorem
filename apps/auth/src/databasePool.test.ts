import { describe, expect, it } from "vitest";
import { databasePoolOptions } from "./databasePool";
describe("elastic auth database budget", () => {
  it("bounds default and configured replicas without retaining idle connections", () => {
    expect(databasePoolOptions({})).toEqual({
      max: 4,
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 7000,
    });
    expect(databasePoolOptions({ AUTH_DATABASE_MAX_CONNS: "2" }).max).toBe(2);
  });
  it.each(["0", "65", "2.5", "oops"])("rejects invalid limit %s", (value) => {
    expect(() => databasePoolOptions({ AUTH_DATABASE_MAX_CONNS: value })).toThrow();
  });
});

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("auth query deadlines", () => {
  it("cancels stalled SQL and keeps the pool usable", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({
      ...databasePoolOptions({}),
      connectionString: process.env.AUTH_TEST_DATABASE_URL,
    });
    try {
      await expect(pool.query("SELECT pg_sleep(10)")).rejects.toMatchObject({ code: "57014" });
      expect((await pool.query("SELECT 1 AS alive")).rows[0].alive).toBe(1);
    } finally {
      await pool.end();
    }
  }, 8000);
});
