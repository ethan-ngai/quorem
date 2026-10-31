import type { Receipts } from "../../events/scheduling/scheduling.ts";

interface AlarmTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface AdmissionAlarmStorage extends AlarmTransaction {
  transaction<T>(action: (tx: AlarmTransaction) => Promise<T>): Promise<T>;
}
/** Receipt ownership and durable alarms make delayed or uncertain commits recoverable. */
export class AdmissionRecovery {
  private storage: AdmissionAlarmStorage;
  private receipts: Receipts;
  private dispatch: () => Promise<{ pending: boolean }>;
  constructor(
    storage: AdmissionAlarmStorage,
    receipts: Receipts,
    dispatch: () => Promise<{ pending: boolean }>,
  ) {
    this.storage = storage;
    this.receipts = receipts;
    this.dispatch = dispatch;
  }
  async prearm(shard: number): Promise<void> {
    if (!Number.isInteger(shard) || shard < 0 || shard > 255)
      throw new RangeError("Invalid admission shard");
    await this.storage.transaction(async (tx) => {
      const previous = await tx.get<number>("shard");
      if (previous !== undefined && previous !== shard) throw new Error("Admission shard mismatch");
      await tx.put("shard", shard);
      await tx.put("generation", ((await tx.get<number>("generation")) ?? 0) + 1);
      const time = Date.now() + 100,
        current = await tx.getAlarm();
      if (current === null || current > time) await tx.setAlarm(time);
    });
  }
  async wake(shard: number): Promise<void> {
    await this.prearm(shard);
  }
  async alarm(): Promise<void> {
    const state = await this.storage.transaction(async (tx) => {
      const shard = await tx.get<number>("shard");
      if (shard === undefined) throw new Error("Admission shard unavailable");
      const generation = (await tx.get<number>("generation")) ?? 0;
      await tx.setAlarm(Date.now() + 1000);
      return { shard, generation };
    });
    const ids = await this.receipts.list(state.shard);
    const committed: string[] = [];
    let retry = ids.length === 64;
    for (const id of ids) {
      const status = await this.receipts.settle(id);
      if (status === "pending") retry = true;
      if (status === "committed") committed.push(id);
    }
    const result = await this.dispatch();
    if (result.pending) retry = true;
    if (!result.pending) for (const id of committed) await this.receipts.acknowledge(id);
    if (!retry)
      await this.storage.transaction(async (tx) => {
        if (((await tx.get<number>("generation")) ?? 0) === state.generation)
          await tx.deleteAlarm();
      });
  }
}
