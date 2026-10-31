/** @file coordinator.ts @description Durable shard alarms and receipt reconciliation. @module events */
import {
  drainDeadlines,
  type DeadlineStore,
  type Receipts,
  type Reconcile,
} from "../../modules/events/scheduling/scheduling.ts";
interface StorageTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export interface AlarmStorage extends StorageTransaction {
  transaction<T>(callback: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}
export interface Dependencies {
  store: DeadlineStore;
  receipts: Receipts;
  reconcile: Reconcile;
  shards: number;
}
const retryMs = 1000;
/** Alarm storage transactions prevent a concurrent earlier wake being overwritten. */
export class ShardAlarm {
  constructor(privateStorage: AlarmStorage, dependencies: Dependencies) {
    this.storage = privateStorage;
    this.dependencies = dependencies;
  }
  private storage: AlarmStorage;
  private dependencies: Dependencies;
  async wake(shard: number): Promise<void> {
    if (!Number.isInteger(shard) || shard < 0 || shard >= this.dependencies.shards)
      throw new RangeError("Invalid shard");
    await this.storage.transaction(async (tx) => {
      const old = await tx.get<number>("shard");
      if (old !== undefined && old !== shard) throw new Error("Coordinator shard mismatch");
      await tx.put("shard", shard);
      const at = Date.now() + 100;
      const current = await tx.getAlarm();
      if (current === null || current > at) await tx.setAlarm(at);
    });
  }
  async alarm(): Promise<void> {
    const shard = await this.storage.get<number>("shard");
    if (shard === undefined) throw new Error("Uninitialized coordinator");
    const { store, receipts, reconcile, shards } = this.dependencies;
    const ids = await receipts.list(shard);
    const committed: string[] = [];
    let retry = ids.length === 64;
    for (const id of ids) {
      const status = await receipts.settle(id);
      if (status === "pending") retry = true;
      if (status === "committed") committed.push(id);
    }
    const delay = await drainDeadlines(store, reconcile, shard, shards);
    // Persist the next deadline before acknowledging committed receipts.
    if (delay !== null || retry)
      await this.storage.transaction(async (tx) => {
        const current = await tx.getAlarm();
        const requested =
          Date.now() + Math.max(100, Math.min(delay ?? retryMs, retry ? retryMs : Infinity));
        if (current === null || current > requested) await tx.setAlarm(requested);
      });
    for (const id of committed) await receipts.acknowledge(id);
  }
}
