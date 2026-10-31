import { it, expect } from "vitest";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { matchConformance } from "./test/conformance.ts";
const url = process.env.QUOREM_SOCKET_MATCH_TEST_URL;
it.skipIf(!url)("composes actual 21 match and invitation authority", async () => {
  const parsed = new URL(url!);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55489",
    "/quorem_hono_stream_lifecycle_test",
  ]);
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  try {
    const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, f);
    await matchConformance(run);
  } finally {
    await pool.end();
  }
});
