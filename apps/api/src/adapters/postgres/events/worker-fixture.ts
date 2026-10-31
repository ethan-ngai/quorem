import { withWorkerConnection } from "@quorem/database/core";
import { postgresDispatch } from "./dispatch.ts";
export default {
  async fetch(_request: Request, env: { DISPATCH_DATABASE_URL: string }) {
    const url = new URL(env.DISPATCH_DATABASE_URL);
    if (url.port !== "55452" || url.pathname !== "/quorem_hono_dispatch_test")
      return new Response(null, { status: 500 });
    const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
      withWorkerConnection(
        env.DISPATCH_DATABASE_URL,
        { connectionTimeoutMs: 3000, lifetimeMs: 5000 },
        fn,
      );
    const store = postgresDispatch(run);
    const claims = await store.claim("membership", 1, 1000);
    if (!claims.length) return Response.json({ claimed: false });
    return Response.json({ claimed: true, ack: await store.acknowledge(claims[0]!) });
  },
};
