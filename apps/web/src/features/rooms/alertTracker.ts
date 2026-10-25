/** @file alertTracker.ts @description Monotonic, bounded snapshot alert tracking. @module rooms */

/** Historical snapshots seed the tracker silently; stale snapshots cannot replay alerts. */
export function createAlertTracker<T extends { id: string }>() {
  let version: bigint | undefined;
  let seen = new Set<string>();
  return (nextVersion: bigint, events: readonly T[]) => {
    if (version !== undefined && nextVersion <= version) return [];
    const added = version === undefined ? [] : events.filter((event) => !seen.has(event.id));
    seen = new Set(events.map((event) => event.id));
    version = nextVersion;
    return added;
  };
}
