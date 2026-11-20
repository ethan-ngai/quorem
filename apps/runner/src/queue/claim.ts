import {
  assertClaimFence,
  type AttemptFence,
  type Job,
  type SandboxControl,
} from "@quorem/execution";
import { UnconfirmedTeardown } from "../sandbox/types.ts";

export interface ClaimAuthority {
  quarantineAttempt(fence: AttemptFence, signal?: AbortSignal): Promise<void>;
  reserveExpiredAttempt(
    resumable: boolean,
    scope: string,
    signal?: AbortSignal,
  ): Promise<AttemptFence | null>;
  claimAfterTeardown(
    resumable: boolean,
    scope: string,
    proof: AttemptFence | null,
    signal?: AbortSignal,
  ): Promise<Job | null>;
}
/** An uncertain sandbox keeps its reservation until a later exact teardown succeeds. */
export async function deferUnconfirmedTeardown(
  authority: Pick<ClaimAuthority, "quarantineAttempt">,
  fence: AttemptFence,
  error: unknown,
  signal?: AbortSignal,
): Promise<void> {
  if (!(error instanceof UnconfirmedTeardown) || signal?.aborted) throw error;
  await authority.quarantineAttempt(fence, signal);
  console.warn(
    JSON.stringify({
      event: "attempt-teardown-deferred",
      attemptId: fence.attemptId,
      diagnostic: error.diagnostic,
    }),
  );
}
/** A notification is only a wake; the authority chooses the eligible job. */
export async function claimNext(
  authority: ClaimAuthority,
  sandbox: SandboxControl,
  options: { resumable: boolean; scope: string; signal?: AbortSignal },
): Promise<Job | null> {
  const candidate = await authority.reserveExpiredAttempt(
    options.resumable,
    options.scope,
    options.signal,
  );
  if (candidate) {
    assertClaimFence(options.scope, candidate);
    try {
      await sandbox.teardownAttempt(candidate, options.signal);
    } catch (error) {
      await deferUnconfirmedTeardown(authority, candidate, error, options.signal);
      return authority.claimAfterTeardown(options.resumable, options.scope, null, options.signal);
    }
    const reclaimed = await authority.claimAfterTeardown(
      options.resumable,
      options.scope,
      candidate,
      options.signal,
    );
    if (reclaimed) return reclaimed;
  }
  return authority.claimAfterTeardown(options.resumable, options.scope, null, options.signal);
}
