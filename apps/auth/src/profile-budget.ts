export const profileMutationLifetimeMs = 15000;
export interface ProfileMutationLease {
  id: string;
  ownerHash: string;
  generation: string;
  deadlineUnixMs: number;
}
/** Expired leases remain charged until the owner has stopped and releases them. */
export interface ProfileMutationBudget {
  acquire(
    userId: string,
  ): Promise<
    { allowed: true; lease: ProfileMutationLease } | { allowed: false; retryAfterSeconds: number }
  >;
  release(lease: ProfileMutationLease): Promise<void>;
}
