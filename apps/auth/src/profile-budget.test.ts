import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { withNodeConnection } from "@quorem/database/core";
import { drizzleProfileBudget } from "./adapters/drizzle-profile-budget.ts";
import { migrateAuth } from "./migrations.ts";

const url = process.env.PROFILE_TEST_DATABASE_URL;
describe.skipIf(!url)("profile mutation admission in PostgreSQL", () => {
  if (
    url &&
    (new URL(url).hostname !== "127.0.0.1" ||
      new URL(url).port !== "55449" ||
      new URL(url).pathname !== "/quorem_hono_profile_test")
  )
    throw new Error("Expected disposable profile database");
  const pool = new Pool({ connectionString: url, max: 20 });
  const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 15000 }, callback);
  const budget = drizzleProfileBudget(run);
  beforeAll(async () => {
    await migrateAuth(pool);
  });
  beforeEach(async () => {
    await pool.query(
      "DELETE FROM quorem_auth.profile_mutation_lease; DELETE FROM quorem_auth.profile_mutation_window",
    );
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM quorem_auth.profile_mutation_lease; DELETE FROM quorem_auth.profile_mutation_window",
    );
    await pool.end();
  });
  it("shares four slots across concurrent factories and never reclaims expired work", async () => {
    const other = drizzleProfileBudget(run);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? budget : other).acquire(`user-${i}`)),
    );
    const accepted = results.filter((r) => r.allowed);
    expect(accepted).toHaveLength(4);
    await pool.query(
      "UPDATE quorem_auth.profile_mutation_lease SET deadline_at=clock_timestamp()-interval '1 minute'",
    );
    expect((await other.acquire("extra")).allowed).toBe(false);
    const lease = accepted[0].lease;
    await other.release({ ...lease, generation: "wrong" });
    expect((await other.acquire("extra")).allowed).toBe(false);
    await budget.release(lease);
    await budget.release(lease);
    expect((await other.acquire("extra")).allowed).toBe(true);
  });
  it("enforces ten attempts per subject and evaluates expiry after the lock", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await budget.acquire("alice");
      expect(r.allowed).toBe(true);
      if (r.allowed) await budget.release(r.lease);
    }
    expect((await budget.acquire("alice")).allowed).toBe(false);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(714901,12)");
      await client.query(
        "UPDATE quorem_auth.profile_mutation_window SET expires_at=clock_timestamp()+interval '150 milliseconds'",
      );
      const waiting = budget.acquire("alice");
      await new Promise((resolve) => setTimeout(resolve, 300));
      await client.query("COMMIT");
      expect((await waiting).allowed).toBe(true);
    } finally {
      client.release();
    }
  });
  it("leaves capacity charged when release cannot reach the database", async () => {
    const admitted = await Promise.all(
      Array.from({ length: 4 }, (_, i) => budget.acquire(`owner-${i}`)),
    );
    const first = admitted[0];
    if (!first.allowed) throw new Error("fixture admission failed");
    const unavailable = drizzleProfileBudget(async () => {
      throw new Error("connection unavailable");
    });
    await expect(unavailable.release(first.lease)).rejects.toThrow("connection unavailable");
    expect((await budget.acquire("another")).allowed).toBe(false);
    await budget.release(first.lease);
    expect((await budget.acquire("another")).allowed).toBe(true);
  });
  it("bounds live subjects and prunes expired windows", async () => {
    await pool.query(
      "INSERT INTO quorem_auth.profile_mutation_window SELECT 'fixture-'||n,1,clock_timestamp()+interval '1 minute' FROM generate_series(1,10000) n",
    );
    expect((await budget.acquire("new")).allowed).toBe(false);
    await pool.query(
      "UPDATE quorem_auth.profile_mutation_window SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_hash='fixture-1'",
    );
    expect((await budget.acquire("new")).allowed).toBe(true);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM quorem_auth.profile_mutation_window")).rows[0]
          .count,
      ),
    ).toBe(10000);
  });
});
