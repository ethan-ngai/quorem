import type { EventEnvelope, MatchSnapshot } from "@quorem/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["waiting", "ready", "active", "finalizing", "completed", "cancelled"]);
const difficulties = new Set(["easy", "medium", "hard"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function version(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

/** Checks the required public snapshot shape before trusting network JSON. */
export function isMatchSnapshot(value: unknown, matchId?: string): value is MatchSnapshot {
  if (!record(value)) return false;
  return (
    typeof value.id === "string" &&
    uuidPattern.test(value.id) &&
    (!matchId || value.id === matchId) &&
    version(value.version) !== undefined &&
    typeof value.state === "string" &&
    states.has(value.state) &&
    typeof value.serverNow === "string" &&
    Number.isFinite(Date.parse(value.serverNow)) &&
    typeof value.difficulty === "string" &&
    difficulties.has(value.difficulty) &&
    [15, 30, 45, 60].includes(value.durationMinutes as number) &&
    Array.isArray(value.participants) &&
    value.participants.every(
      (participant) =>
        record(participant) &&
        typeof participant.userId === "string" &&
        uuidPattern.test(participant.userId) &&
        typeof participant.displayName === "string" &&
        typeof participant.ready === "boolean" &&
        (participant.presence === "online" || participant.presence === "offline"),
    ) &&
    typeof value.hostUserId === "string" &&
    uuidPattern.test(value.hostUserId) &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

/** Accepts only match events carrying their complete, matching snapshot. */
export function parseMatchEvent(value: unknown, matchId: string): EventEnvelope | undefined {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.aggregateId !== matchId ||
    typeof value.eventId !== "string" ||
    !uuidPattern.test(value.eventId) ||
    typeof value.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(value.occurredAt)) ||
    version(value.aggregateVersion) === undefined ||
    (value.type !== "match.updated" && value.type !== "match.completed") ||
    !isMatchSnapshot(value.payload, matchId)
  )
    return undefined;

  if (value.payload.version !== value.aggregateVersion) return undefined;
  return value as unknown as EventEnvelope;
}

export type EventMerge = { snapshot: MatchSnapshot; gap: boolean };

/** Applies newer events in version order, reporting skipped aggregate versions. */
export function mergeMatchEvents(
  snapshot: MatchSnapshot,
  events: readonly EventEnvelope[],
): EventMerge {
  let current = snapshot;
  let gap = false;
  const ordered = [...events].sort((a, b) => {
    const av = version(a.aggregateVersion) ?? 0n;
    const bv = version(b.aggregateVersion) ?? 0n;
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  for (const event of ordered) {
    if (event.type === "submission.updated") continue;
    const currentVersion = version(current.version);
    const incomingVersion = version(event.aggregateVersion);
    if (
      currentVersion === undefined ||
      incomingVersion === undefined ||
      incomingVersion <= currentVersion
    )
      continue;
    if (incomingVersion !== currentVersion + 1n) {
      gap = true;
      continue;
    }
    current = event.payload;
  }
  return { snapshot: current, gap };
}

/** Keeps a valid cache snapshot when an older request finishes late. */
export function keepNewestSnapshot(
  previous: MatchSnapshot | undefined,
  incoming: MatchSnapshot,
): MatchSnapshot {
  if (!previous) return incoming;
  const previousVersion = version(previous.version);
  const incomingVersion = version(incoming.version);
  return previousVersion !== undefined &&
    incomingVersion !== undefined &&
    incomingVersion < previousVersion
    ? previous
    : incoming;
}

/** Schedules bounded reconnects; injected timers keep lifecycle behavior testable. */
export function createReconnectScheduler(
  connect: () => void,
  schedule: (callback: () => void, delay: number) => number,
  cancel: (timer: number) => void,
  random: () => number = Math.random,
) {
  let retry = 0;
  let timer: number | undefined;

  return {
    schedule() {
      if (timer !== undefined) return;
      const ceiling = Math.min(10_000, 500 * 2 ** Math.min(retry, 5));
      const delay = Math.round(ceiling * (0.8 + random() * 0.4));
      retry += 1;
      timer = schedule(() => {
        timer = undefined;
        connect();
      }, delay);
    },
    reset() {
      retry = 0;
    },
    stop() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
  };
}
