/** @file commandRecovery.ts @description Owner-scoped mutation mutation retry keys. @module matches */
import { randomUUID } from "../../randomUUID";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { RejectedMatchCommand } from "./errors";

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
      : { key: randomUUID(), payload };
  volatilePending.set(storageKey(identity, operation), command);
  try {
    localStorage.setItem(storageKey(identity, operation), JSON.stringify(command));
  } catch {
    /* The current invocation still sends a valid idempotency key. */
  }
  let result: TResult;
  try {
    result = await request(command.payload, command.key);
  } catch (error) {
    if (error instanceof RejectedMatchCommand) {
      volatilePending.delete(storageKey(identity, operation));
      try {
        localStorage.removeItem(storageKey(identity, operation));
      } catch {
        /* Storage may be unavailable; the in-memory command is still released. */
      }
    }
    throw error;
  }
  volatilePending.delete(storageKey(identity, operation));
  try {
    localStorage.removeItem(storageKey(identity, operation));
  } catch {
    /* A retained key safely replays the same command. */
  }
  return result;
}
