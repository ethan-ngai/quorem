/** @file scheduling.ts @description Deadline wake and owning-command contracts. @module events */
export interface DeadlineCandidate {
  id: string;
  generation: string | null;
}
export interface DeadlineStore {
  candidates(shard: number, shards: number, limit: number): Promise<DeadlineCandidate[]>;
  delay(shard: number, shards: number): Promise<number | null>;
}
export interface Coordinator {
  prearm(shard: number): Promise<void>;
  wake(shard: number): Promise<void>;
}
export interface Receipts {
  create(id: string, shard: number): Promise<void>;
  settle(id: string): Promise<"committed" | "pending" | "abandoned">;
  acknowledge(id: string): Promise<void>;
  list(shard: number, limit?: number): Promise<string[]>;
}
export type Reconcile = (candidate: DeadlineCandidate) => Promise<void>;

/** The activation consumes its receipt inside its own transaction. */
export async function activateDeadline<T>(
  receipts: Receipts,
  coordinator: Coordinator,
  shard: number,
  activate: (id: string) => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  await receipts.create(id, shard);
  await coordinator.prearm(shard);
  const result = await activate(id);
  try {
    await coordinator.wake(shard);
  } catch {
    /* The receipt and prearmed alarm remain durable. */
  }
  return result;
}

/** Bounded processing; owning commands recheck authority and database time under their locks. */
export async function drainDeadlines(
  store: DeadlineStore,
  reconcile: Reconcile,
  shard: number,
  shards: number,
  limit = 32,
): Promise<number | null> {
  const candidates = await store.candidates(shard, shards, limit);
  for (const candidate of candidates) await reconcile(candidate);
  const delay = await store.delay(shard, shards);
  // Locked rows and work arriving during the drain require another bounded pass.
  return candidates.length === limit ? 100 : delay === null ? null : Math.max(100, delay);
}
