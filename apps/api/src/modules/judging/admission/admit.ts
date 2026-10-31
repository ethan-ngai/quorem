import { requiredPrewake } from "../../events/dispatch/dispatch.ts";
import type { ExecutionWakePublisher } from "../../events/dispatch/ports.ts";
import { ApplicationError } from "../../../application/error.ts";
import type { Coordinator, Receipts } from "../../events/scheduling/scheduling.ts";

export interface AdmissionFence {
  receiptId: string;
  shard: number;
  jobId: string;
}
/** The transaction consumes this receipt and atomically writes the job and execution intent. */
export async function admitWithRecovery<T>(options: {
  receipts: Receipts;
  coordinator: Coordinator;
  publisher: ExecutionWakePublisher;
  shard: number;
  commit(fence: AdmissionFence): Promise<T>;
}): Promise<T> {
  const fence = {
    receiptId: crypto.randomUUID(),
    shard: options.shard,
    jobId: crypto.randomUUID(),
  };
  await options.receipts.create(fence.receiptId, fence.shard);
  await options.coordinator.prearm(fence.shard);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      requiredPrewake(options.publisher, fence.jobId, Date.now() + 10000),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ApplicationError("temporarily_unavailable", "Judge unavailable", 503)),
          2000,
        );
      }),
    ]);
  } catch (cause) {
    const error = new ApplicationError("temporarily_unavailable", "Judge unavailable", 503);
    Object.defineProperty(error, "cause", { value: cause });
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const result = await options.commit(fence);
  try {
    await options.coordinator.wake(fence.shard);
  } catch {
    /* Prearmed recovery owns the committed receipt. */
  }
  return result;
}
