/** @file database-usage.ts @description Per-invocation database counters for Workers Logs. @module runtime */
import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseUsage } from "@quorem/database/core";

type RearmReason = "pending-work" | "recent-activity" | "new-activity";
type Invocation = DatabaseUsage & {
  trigger: string;
  operation: string;
  credential?: string;
  principal?: string;
  rearm?: RearmReason[];
};

const usage = new AsyncLocalStorage<Invocation>();

export const currentDatabaseUsage = () => usage.getStore();

export async function measureDatabase<T>(
  enabled: boolean,
  trigger: string,
  operation: string,
  work: () => Promise<T>,
  credential?: string,
): Promise<T> {
  if (!enabled) return work();
  const counts = { trigger, operation, credential, scopes: 0, transactions: 0, queryCalls: 0 };
  try {
    return await usage.run(counts, work);
  } finally {
    flushDatabaseUsage(counts);
  }
}

export function flushDatabaseUsage(counts: Invocation | undefined) {
  if (!counts || !(counts.scopes || counts.queryCalls)) return;
  console.log({ event: "database-usage", ...counts });
  counts.scopes = counts.transactions = counts.queryCalls = 0;
}

/** Route labels exclude raw path parameters, query strings and credentials. */
export function databaseRoute(path: string): string {
  if (path === "/v1/presence/heartbeat") return "presence.heartbeat";
  if (path === "/v1/parties/current") return "party.current";
  if (/^\/v1\/parties(?:\/|$)/.test(path)) return "party";
  if (path === "/v1/problems") return "catalog";
  if (/^\/v1\/(?:problems|question-publications)\//.test(path)) return "question";
  if (path.startsWith("/api/auth/")) return "auth";
  if (/^\/v1\/submissions(?:\/|$)/.test(path)) return "submission";
  if (path.startsWith("/internal/runner/")) return "runner";
  if (path.startsWith("/internal/verification/")) return "verification";
  if (/^\/v1\/matches(?:\/|$)/.test(path)) return "match";
  if (/^\/v1\/interviews(?:\/|$)/.test(path)) return "interview";
  return "other";
}

export function requestCredential(request: Request) {
  if (request.headers.has("authorization")) return "authorization-header";
  if (request.headers.has("cookie")) return "cookie";
  return "none";
}
