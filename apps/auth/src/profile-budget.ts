/** Distributed admission contract; limits count every photo mutation and leases bound concurrency. */
export interface ProfileMutationBudget {
  acquire(userId: string): Promise<
    | { allowed: true; leaseId: string; expiresAtUnixMs: number }
    | { allowed: false; retryAfterSeconds: number }
  >;
  release(leaseId: string): Promise<void>;
}
