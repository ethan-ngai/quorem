import { matchRulesSchema } from "@quorem/contracts/match-rules";
/** @file matchSync.ts @description Runtime guards and version helpers for match synchronization. @module realtime */
import type { EventEnvelope, MatchSnapshot } from "@quorem/contracts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["waiting", "ready", "active", "finalizing", "completed", "cancelled"]);
const difficulties = new Set(["easy", "medium", "hard"]);

const submissionStates = new Set(["queued", "running", "completed", "cancelled", "failed"]);
const outcomeKinds = new Set(["win", "draw", "no_contest", "cancelled"]);

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

/** Checks the required public snapshot shape before trusting network JSON. */
export function isMatchSnapshot(value: unknown, matchId?: string): value is MatchSnapshot {
  if (!record(value)) return false;
  const participantIds = new Set<string>();
  if (
    !Array.isArray(value.participants) ||
    value.participants.length > (value.mode === "showdown" ? 2 : 8) ||
    value.participants.some((participant) => {
      if (
        !record(participant) ||
        typeof participant.userId !== "string" ||
        !uuidPattern.test(participant.userId) ||
        typeof participant.displayName !== "string" ||
        typeof participant.ready !== "boolean" ||
        (participant.image !== undefined && typeof participant.image !== "string") ||
        (participant.color !== undefined &&
          (!Number.isInteger(participant.color) ||
            Number(participant.color) < 1 ||
            Number(participant.color) > 24)) ||
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
    (value.mode === "showdown" || value.mode === "free-for-all" || value.mode === "factions") &&
    Array.isArray(value.difficulties) &&
    value.difficulties.length >= 1 &&
    value.difficulties.length <= 3 &&
    value.difficulties.every((pool) => typeof pool === "string" && difficulties.has(pool)) &&
    new Set(value.difficulties).size === value.difficulties.length &&
    matchRulesSchema.safeParse(value.rules).success &&
    (value.questionSelection === undefined ||
      value.questionSelection === "random" ||
      value.questionSelection === "recommended") &&
    (value.selectedProblemVersionId === undefined ||
      (typeof value.selectedProblemVersionId === "string" &&
        uuidPattern.test(value.selectedProblemVersionId))) &&
    Array.isArray(value.ruleEvents) &&
    value.ruleEvents.length <= 100 &&
    value.ruleEvents.every(
      (event) =>
        record(event) &&
        typeof event.id === "string" &&
        uuidPattern.test(event.id) &&
        typeof event.userId === "string" &&
        participantIds.has(event.userId) &&
        ["focus", "clipboard", "copy", "topics", "complexity", "hiddenCase", "submission"].includes(
          String(event.kind),
        ) &&
        (event.action === "announce" || event.action === "penalty") &&
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
    (value.partyId === undefined ||
      (typeof value.partyId === "string" && uuidPattern.test(value.partyId))) &&
    (value.drawOfferUserId === undefined ||
      (typeof value.drawOfferUserId === "string" && participantIds.has(value.drawOfferUserId))) &&
    (value.reviewPending === undefined || typeof value.reviewPending === "boolean") &&
    (value.startedAt === undefined || validDate(value.startedAt)) &&
    (value.deadline === undefined || validDate(value.deadline)) &&
    (value.submissionDeadline === undefined || validDate(value.submissionDeadline)) &&
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

type MatchEvent = Extract<EventEnvelope, { type: "match.updated" | "match.completed" }>;

/** Accepts only match events carrying their complete, matching snapshot. */
export function parseMatchEvent(value: unknown, matchId: string): MatchEvent | undefined {
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
  return value as unknown as MatchEvent;
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
