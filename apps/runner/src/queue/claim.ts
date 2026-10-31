import {
  assertClaimFence,
  type AttemptFence,
  type Job,
  type SandboxControl,
} from "@quorem/execution";

export interface ClaimAuthority {
  nextExpiredAttempt(
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
/** A notification is only a wake; the authority chooses the eligible job. */
export async function claimNext(
  authority: ClaimAuthority,
  sandbox: SandboxControl,
  options: { resumable: boolean; scope: string; signal?: AbortSignal },
): Promise<Job | null> {
  const candidate = await authority.nextExpiredAttempt(
    options.resumable,
    options.scope,
    options.signal,
  );
  if (candidate) {
    assertClaimFence(options.scope, candidate);
    await sandbox.teardownAttempt(candidate, options.signal);
  }
  return authority.claimAfterTeardown(options.resumable, options.scope, candidate, options.signal);
}
