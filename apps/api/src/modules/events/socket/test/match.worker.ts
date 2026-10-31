import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { matchConformance } from "./conformance.ts";
const url = (env as unknown as { SOCKET_MATCH_URL: string }).SOCKET_MATCH_URL;
it("composes actual 21 match and invitation authority in workerd", async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55489",
    "/quorem_hono_stream_lifecycle_test",
  ]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, f);
  await matchConformance(run);
});
