/** @file alertTracker.ts @description Monotonic, bounded snapshot alert tracking. @module rooms */

/** Historical snapshots seed the tracker silently; stale snapshots cannot replay alerts. */
export function createAlertTracker<T extends { id: string; awaySeconds?: number }>() {
  let version: bigint | undefined;
  let seen = new Map<string, number | undefined>();
  return (nextVersion: bigint, events: readonly T[]) => {
    if (version !== undefined && nextVersion <= version) return [];
    const changed =
      version === undefined
        ? []
        : events.filter(({ id, awaySeconds }) => !seen.has(id) || seen.get(id) !== awaySeconds);
    seen = new Map(events.map(({ id, awaySeconds }) => [id, awaySeconds]));
    version = nextVersion;
    return changed;
  };
}
