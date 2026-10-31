/** @file dispatch.ts @description Bounded publish-before-ack dispatch. @module events */
import type {
  DispatchStore,
  ExecutionWakePublisher,
  NoticePublisher,
  Stream,
  Wake,
} from "./ports.ts";

export async function dispatchBatch(
  store: DispatchStore,
  notices: NoticePublisher,
  wakes: ExecutionWakePublisher,
  stream: Stream,
  limit = 32,
  leaseMs = 30_000,
): Promise<{ published: number; pending: boolean }> {
  const claims = await store.claim(stream, limit, leaseMs);
  for (const claim of claims) {
    if (claim.stream === "execution") {
      if (!claim.jobId) throw new Error("Execution claim has no job");
      await wakes.send({ jobId: claim.jobId, phase: "continuation" });
    } else {
      if (!claim.notice) throw new Error("Notice claim has no notice");
      await notices.publish(claim.stream, claim.notice);
    }
    // A lost or expired claim may publish twice; it must never acknowledge a successor.
    await store.acknowledge(claim);
  }
  return { published: claims.length, pending: await store.pending(stream) };
}

/** Admission must await this before opening the transaction that creates the job. */
export async function requiredPrewake(
  publisher: ExecutionWakePublisher,
  jobId: string,
  admissionUntil: number,
): Promise<void> {
  if (!Number.isSafeInteger(admissionUntil) || admissionUntil <= Date.now())
    throw new RangeError("Invalid admission deadline");
  await publisher.send({ jobId, phase: "admission", admissionUntil });
}

/** A precommit wake always creates a delayed durable continuation before acknowledgement. */
export async function consumeWake(
  wake: Wake,
  publisher: ExecutionWakePublisher,
  drain: () => Promise<{ pending: boolean }>,
  now = Date.now(),
): Promise<void> {
  const result = await drain();
  if (
    wake.phase === "admission" &&
    (!Number.isSafeInteger(wake.admissionUntil) || wake.admissionUntil! <= 0)
  )
    throw new Error("Missing admission deadline");
  if ((wake.admissionUntil ?? 0) > now || result.pending)
    await publisher.send({ ...wake, phase: "continuation" }, 2);
}

/** Admission callback must atomically commit its job and intent before returning. */
export async function admitWithRequiredWake<T>(
  publisher: ExecutionWakePublisher,
  jobId: string,
  admissionUntil: number,
  admit: (deadline: number) => Promise<T>,
): Promise<T> {
  await requiredPrewake(publisher, jobId, admissionUntil);
  const value = await admit(admissionUntil);
  // Commit is authoritative; an unavailable immediate wake is repaired from the ledger.
  try {
    await publisher.send({ jobId, phase: "continuation" });
  } catch {
    /* Durable intent remains pending. */
  }
  return value;
}
