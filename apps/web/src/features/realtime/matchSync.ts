/** @file matchSync.ts @description Runtime guards and version helpers for match synchronization. @module realtime */
import type { EventEnvelope, MatchSnapshot } from "@quorem/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["waiting", "ready", "active", "finalizing", "completed", "cancelled"]);
const difficulties = new Set(["easy", "medium", "hard"]);
const ruleActions = new Set(["off", "warning", "announce"]);
const submissionStates = new Set(["queued", "running", "completed", "cancelled", "failed"]);
const outcomeKinds = new Set(["win", "draw", "no_contest", "cancelled"]);

export const MAX_BUFFERED_MATCH_EVENTS = 64;
export type MatchEventBuffer = { events: EventEnvelope[]; overflow: boolean };

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

function validDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validScore(value: unknown): boolean {
  return (
    record(value) &&
    Number.isSafeInteger(value.passed) &&
    Number.isSafeInteger(value.total) &&
    (value.passed as number) >= 0 &&
    (value.total as number) >= 0 &&
    (value.passed as number) <= (value.total as number)
  );
}

/** Caps events accumulated during a REST request and forces a fresh snapshot on overflow. */
export function bufferMatchEvent(buffer: MatchEventBuffer, event: EventEnvelope): void {
  if (buffer.overflow) return;
  if (buffer.events.length >= MAX_BUFFERED_MATCH_EVENTS) {
    buffer.events.length = 0;
    buffer.overflow = true;
    return;
  }
  buffer.events.push(event);
}

/** Checks the required public snapshot shape before trusting network JSON. */
export function isMatchSnapshot(value: unknown, matchId?: string): value is MatchSnapshot {
  if (!record(value)) return false;
  const participantIds = new Set<string>();
  if (
    !Array.isArray(value.participants) ||
    value.participants.length > (value.mode === "free-for-all" ? 8 : 2) ||
    value.participants.some((participant) => {
      if (
        !record(participant) ||
        typeof participant.userId !== "string" ||
        !uuidPattern.test(participant.userId) ||
        typeof participant.displayName !== "string" ||
        typeof participant.ready !== "boolean" ||
        (participant.presence !== "online" && participant.presence !== "offline") ||
        (participant.submissionState !== undefined &&
          (typeof participant.submissionState !== "string" ||
            !submissionStates.has(participant.submissionState))) ||
        (participant.workspaceId !== undefined &&
          (typeof participant.workspaceId !== "string" ||
            !uuidPattern.test(participant.workspaceId))) ||
        (participant.bestScore !== undefined && !validScore(participant.bestScore)) ||
        (participant.forfeited !== undefined && typeof participant.forfeited !== "boolean") ||
        participantIds.has(participant.userId)
      )
        return true;
      participantIds.add(participant.userId);
      return false;
    })
  )
    return false;

  return (
    (value.mode === "showdown" || value.mode === "free-for-all") &&
    Array.isArray(value.difficulties) &&
    value.difficulties.length >= 1 &&
    value.difficulties.length <= 3 &&
    value.difficulties.every((pool) => typeof pool === "string" && difficulties.has(pool)) &&
    new Set(value.difficulties).size === value.difficulties.length &&
    record(value.rules) &&
    typeof value.rules.clipboard === "string" &&
    ruleActions.has(value.rules.clipboard) &&
    typeof value.rules.focus === "string" &&
    ruleActions.has(value.rules.focus) &&
    (value.selectedProblemVersionId === undefined ||
      (typeof value.selectedProblemVersionId === "string" &&
        uuidPattern.test(value.selectedProblemVersionId))) &&
    Array.isArray(value.ruleEvents) &&
    value.ruleEvents.length <= 20 &&
    value.ruleEvents.every(
      (event) =>
        record(event) &&
        typeof event.id === "string" &&
        uuidPattern.test(event.id) &&
        typeof event.userId === "string" &&
        participantIds.has(event.userId) &&
        (event.kind === "focus" || event.kind === "clipboard") &&
        event.action === "announce" &&
        validDate(event.occurredAt),
    ) &&
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
    typeof value.hostUserId === "string" &&
    uuidPattern.test(value.hostUserId) &&
    typeof value.expiresAt === "string" &&
    validDate(value.expiresAt) &&
    (value.startedAt === undefined || validDate(value.startedAt)) &&
    (value.deadline === undefined || validDate(value.deadline)) &&
    (value.finalizingAt === undefined || validDate(value.finalizingAt)) &&
    (value.problemVersionId === undefined ||
      (typeof value.problemVersionId === "string" && uuidPattern.test(value.problemVersionId))) &&
    (value.outcome === undefined ||
      (record(value.outcome) &&
        typeof value.outcome.kind === "string" &&
        outcomeKinds.has(value.outcome.kind) &&
        (value.outcome.winnerUserId === undefined ||
          (typeof value.outcome.winnerUserId === "string" &&
            uuidPattern.test(value.outcome.winnerUserId))) &&
        typeof value.outcome.reason === "string" &&
        validDate(value.outcome.completedAt)))
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
  if (previousVersion === undefined || incomingVersion === undefined) return incoming;
  if (incomingVersion < previousVersion) return previous;
  if (
    incomingVersion === previousVersion &&
    Date.parse(incoming.serverNow) < Date.parse(previous.serverNow)
  )
    return previous;
  return incoming;
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
      const delay = Math.min(10_000, Math.round(ceiling * (0.8 + random() * 0.4)));
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
