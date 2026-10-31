/** @file worker-fixture.ts @description Durable deadline coordinator for lifecycle tests. @module matches */
// @ts-ignore Workerd supplies this built-in module.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection } from "@quorem/database/core";
import { ShardAlarm, type AlarmStorage } from "../../../scheduling/coordinator.ts";
import { postgresDeadlines } from "../../events/scheduling/deadlines.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { reconcileScheduledMatch } from "../reconcile/repository.ts";
export class DeadlineCoordinator extends DurableObject {
  private readonly coordinator: ShardAlarm;
  constructor(state: { storage: AlarmStorage }, env: { MATCH_LIFECYCLE_URL: string }) {
    super(state, env);
    const run = <T>(f: Parameters<typeof withWorkerConnection<T>>[2]) =>
      withWorkerConnection(
        env.MATCH_LIFECYCLE_URL,
        { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
        f,
      );
    this.coordinator = new ShardAlarm(state.storage, {
      store: postgresDeadlines(run),
      receipts: prearmReceipts(run),
      shards: 1,
      reconcile: (c) =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
            reconcileScheduledMatch(tx, c.id, c.generation),
          ),
        ),
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
