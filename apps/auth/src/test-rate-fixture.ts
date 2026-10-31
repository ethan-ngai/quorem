import { Pool } from "pg";

export async function resetTestRateLimits(value: string) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/quorem_hono_auth_native_test" ||
    url.searchParams.has("host")
  )
    throw new Error("Auth tests require the named disposable loopback database");
  const pool = new Pool({ connectionString: value, max: 1 });
  try {
    const existing = await pool.query("SELECT to_regclass('quorem_auth.rate_limit') AS table_name");
    if (existing.rows[0].table_name) await pool.query("DELETE FROM quorem_auth.rate_limit");
  } finally {
    await pool.end();
  }
}
