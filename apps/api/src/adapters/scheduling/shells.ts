/** @file shells.ts @description Node wake and independent scheduled repair. @module events */
import type { Coordinator } from "../../modules/events/scheduling/scheduling.ts";
/** A Node timer only accelerates durable database discovery. */
export function nodeCoordinator(
  run: (shard: number) => Promise<number | null>,
  report: (error: unknown) => void,
): Coordinator & { close(): void } {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let closed = false;
  const wake = async (shard: number) => {
    if (closed) throw new Error("Coordinator closed");
    const old = timers.get(shard);
    if (old) clearTimeout(old);
    timers.set(
      shard,
      setTimeout(async () => {
        timers.delete(shard);
        try {
          const delay = await run(shard);
          if (delay !== null && !closed && !timers.has(shard))
            timers.set(
              shard,
              setTimeout(
                () => {
                  void wake(shard).catch(report);
                },
                Math.max(100, delay),
              ),
            );
        } catch (error) {
          report(error);
          if (!closed && !timers.has(shard))
            timers.set(
              shard,
              setTimeout(() => {
                void wake(shard).catch(report);
              }, 1000),
            );
        }
      }, 0),
    );
  };
  return {
    prearm: wake,
    wake,
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
/** Independently rearm all bounded shards and execute one bounded maintenance batch. */
export async function scheduledRepair(
  coordinator: Coordinator,
  shards: number,
  maintenance: () => Promise<unknown>,
): Promise<void> {
  if (!Number.isInteger(shards) || shards < 1 || shards > 256)
    throw new RangeError("Invalid shard count");
  const results = await Promise.allSettled([
    ...Array.from({ length: shards }, (_, shard) => coordinator.wake(shard)),
    maintenance(),
  ]);
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed.length)
    throw new AggregateError(
      failed.map((result) => result.reason),
      "Scheduled repair failed",
    );
}
