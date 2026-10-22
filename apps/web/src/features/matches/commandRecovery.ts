/** @file commandRecovery.ts @description Owner-scoped mutation retry keys and private invitation recovery. @module matches */
import type { CreateMatchRequest, DevelopmentIdentity, MatchInvite } from "@quorem/contracts";

type PendingCommand<T> = { key: string; payload: T };
const volatilePending = new Map<string, PendingCommand<unknown>>();
const storageKey = (identity: DevelopmentIdentity, operation: string) =>
  `quorem.match-command.v1:${identity}:${operation}`;

/** @returns A persisted pending command, or nothing when browser storage is unavailable. */
export function readPendingCommand<T>(
  identity: DevelopmentIdentity,
  operation: string,
): PendingCommand<T> | undefined {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(identity, operation)) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "key" in value &&
      typeof value.key === "string" &&
      "payload" in value
    )
      return value as PendingCommand<T>;
  } catch {
    /* Browser storage cannot be required for match access. */
  }
  return volatilePending.get(storageKey(identity, operation)) as PendingCommand<T> | undefined;
}

/** @returns Create settings frozen for a retry after an uncertain network response. */
export function pendingCreate(identity: DevelopmentIdentity) {
  const command = readPendingCommand<CreateMatchRequest>(identity, "create");
  if (
    command &&
    (command.payload?.mode === undefined ||
      ["showdown", "free-for-all"].includes(command.payload.mode)) &&
    (!!command.payload?.selectedProblemVersionId ||
      (Array.isArray(command.payload?.difficulties) &&
        command.payload.difficulties.length > 0 &&
        command.payload.difficulties.every((pool) => ["easy", "medium", "hard"].includes(pool))) ||
      (typeof command.payload?.difficulty === "string" &&
        ["easy", "medium", "hard"].includes(command.payload.difficulty))) &&
    [15, 30, 45, 60].includes(command.payload?.durationMinutes)
  )
    return command;
  return undefined;
}

/** @returns A command result, reusing the exact key and payload after an uncertain response. */
export async function recoverableCommand<TPayload, TResult>(
  identity: DevelopmentIdentity,
  operation: string,
  payload: TPayload,
  request: (payload: TPayload, key: string) => Promise<TResult>,
  freezePayload = false,
): Promise<TResult> {
  const existing = readPendingCommand<TPayload>(identity, operation);
  const command =
    existing && (freezePayload || JSON.stringify(existing.payload) === JSON.stringify(payload))
      ? existing
      : { key: crypto.randomUUID(), payload };
  volatilePending.set(storageKey(identity, operation), command);
  try {
    localStorage.setItem(storageKey(identity, operation), JSON.stringify(command));
  } catch {
    /* The current invocation still sends a valid idempotency key. */
  }
  const result = await request(command.payload, command.key);
  volatilePending.delete(storageKey(identity, operation));
  try {
    localStorage.removeItem(storageKey(identity, operation));
  } catch {
    /* A retained key safely replays the same command. */
  }
  return result;
}

/** Retains the private link across reloads and the create-response recovery boundary. */
export function rememberInvite(identity: DevelopmentIdentity, invite: MatchInvite) {
  try {
    localStorage.setItem(`quorem.match-invite.v1:${identity}:${invite.id}`, invite.inviteUrl);
    localStorage.setItem(`quorem.last-match.v1:${identity}`, invite.id);
  } catch {
    /* The caller can still enter the server-issued match. */
  }
}

/** @returns The owner's saved invitation resolved against the current app origin. */
export function readInvite(identity: DevelopmentIdentity, matchId: string) {
  try {
    const saved = localStorage.getItem(`quorem.match-invite.v1:${identity}:${matchId}`);
    if (!saved) return null;
    // Older API responses stored absolute localhost links; retain only their route.
    const invite = new URL(saved, window.location.origin);
    return new URL(`${invite.pathname}${invite.search}${invite.hash}`, window.location.origin).href;
  } catch {
    return null;
  }
}
