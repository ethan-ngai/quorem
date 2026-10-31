/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
import worker, { type Env } from "../worker.ts";
it("uses only explicitly trusted edge peer addresses for Better Auth buckets", async () => {
  const db = (env as unknown as { DB: { connectionString: string } }).DB.connectionString;
  const check = new URL((env as unknown as { DATABASE_CHECK: string }).DATABASE_CHECK);
  expect([check.hostname, check.port, check.pathname]).toEqual([
    "127.0.0.1",
    "55575",
    "/quorem_hono_runtime_test",
  ]);
  await withWorkerConnection(db, { connectionTimeoutMs: 2000, lifetimeMs: 10000 }, (scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      tx.execute(sql`DELETE FROM quorem_auth.rate_limit`),
    ),
  );
  const configured = { ...(env as unknown as Env), TRUST_CLOUDFLARE_PEER: "true" };
  const call = (peer: string, forged: string, trusted = true) =>
    worker.fetch(
      new Request("http://127.0.0.1:8765/api/auth/get-session", {
        headers: {
          "cf-connecting-ip": peer,
          "x-quorem-peer-ip": forged,
          "x-forwarded-for": forged,
        },
      }),
      { ...configured, TRUST_CLOUDFLARE_PEER: trusted ? "true" : "false" },
    );
  for (let i = 0; i < 30; i++) {
    const response = await call("192.0.2.1", `198.51.100.${i + 1}`);
    expect(response.status).toBe(200);
    await response.body?.cancel();
  }
  expect((await call("192.0.2.1", "203.0.113.1")).status).toBe(429);
  expect((await call("192.0.2.2", "192.0.2.1")).status).toBe(200);
  for (let i = 0; i < 30; i++) {
    const response = await call(`198.51.100.${i + 1}`, `203.0.113.${i + 1}`, false);
    expect(response.status).toBe(200);
    await response.body?.cancel();
  }
  expect((await call("198.51.100.40", "203.0.113.40", false)).status).toBe(429);
});
