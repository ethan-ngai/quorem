import { expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { capabilityRepository, capabilitiesInTransaction } from "./repository.ts";
const url = process.env.QUOREM_ADMISSION_TEST_DATABASE_URL;
it.skipIf(!url)("transactional capability reads match the existing repository", async () => {
  const parsed = new URL(url!);
  if (
    parsed.port !== "55458" ||
    parsed.pathname !== "/quorem_hono_admission_test" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    throw new Error("Disposable admission database required");
  const pool = createNodePool({
      connectionString: url!,
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    }),
    user = `caps-${crypto.randomUUID()}`;
  try {
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
    await pool.query(
      "INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES($1,'guest_concurrency',20,'fixture','test')",
      [user],
    );
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 5000 }, fn);
    const old = await run((scope) => capabilityRepository(scope).capabilities(user));
    const transactional = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true }, (tx) =>
        capabilitiesInTransaction(tx, user),
      ),
    );
    expect(transactional).toEqual(old);
    expect(transactional.guestConcurrency).toBe(8);
  } finally {
    await pool.query("DELETE FROM quota_overrides WHERE user_id=$1", [user]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.end();
  }
});
