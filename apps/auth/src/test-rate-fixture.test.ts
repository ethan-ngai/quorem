import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateAuth } from "./migrations.ts";
import { resetTestRateLimits } from "./test-rate-fixture.ts";

it("rejects non-disposable and non-loopback database URLs", async () => {
  for (const url of [
    "postgres://localhost/quorem",
    "postgres://example.test/quorem_hono_auth_native_test",
    "https://127.0.0.1/quorem_hono_auth_native_test",
    "postgres://127.0.0.1/quorem_hono_auth_native_test?host=example.test",
  ])
    await expect(resetTestRateLimits(url)).rejects.toThrow("named disposable loopback database");
});

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("rate fixture reset", () => {
  it("clears shared rate limits without removing unrelated auth records", async () => {
    const url = process.env.AUTH_TEST_DATABASE_URL!;
    const pool = new Pool({ connectionString: url });
    const id = crypto.randomUUID();
    try {
      await migrateAuth(pool);
      await pool.query(
        'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
        [id, "fixture", `${id}@example.test`],
      );
      await pool.query(
        "INSERT INTO quorem_auth.rate_limit(bucket,used,expires_at) VALUES($1,1,clock_timestamp()+interval '1 minute')",
        [id],
      );
      await resetTestRateLimits(url);
      expect(
        Number((await pool.query("SELECT count(*) FROM quorem_auth.rate_limit")).rows[0].count),
      ).toBe(0);
      expect(
        (await pool.query('SELECT 1 FROM quorem_auth."user" WHERE id=$1', [id])).rowCount,
      ).toBe(1);
    } finally {
      await pool.query('DELETE FROM quorem_auth."user" WHERE id=$1', [id]);
      await pool.end();
    }
  });
});
