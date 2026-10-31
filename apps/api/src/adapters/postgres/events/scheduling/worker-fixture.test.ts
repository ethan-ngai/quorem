// @ts-expect-error Workerd provides this module at runtime.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection } from "@quorem/database/core";
import { ShardAlarm } from "../../../scheduling/coordinator.ts";
import { postgresDeadlines } from "./deadlines.ts";
import { prearmReceipts } from "./prearm.ts";
export class DeadlineCoordinator extends DurableObject {
  coordinator;
  constructor(
    state: { storage: import("../../../scheduling/coordinator.ts").AlarmStorage },
    env: { SCHEDULING_DATABASE_URL: string },
  ) {
    super(state, env);
    const url = new URL(env.SCHEDULING_DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.searchParams.has("host") ||
      url.pathname !== "/quorem_hono_scheduling_test"
    )
      throw new Error("Disposable database required");
    const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
      withWorkerConnection(
        env.SCHEDULING_DATABASE_URL,
        { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
        fn,
      );
    this.coordinator = new ShardAlarm(state.storage, {
      store: postgresDeadlines(run),
      receipts: prearmReceipts(run),
      shards: 256,
      reconcile: async () => {
        throw new Error("Fixture has no transition owner");
      },
    });
  }
  wake(shard: number) {
    return this.coordinator.wake(shard);
  }
  alarm() {
    return this.coordinator.alarm();
  }
}
export default { fetch: () => new Response("fixture") };
