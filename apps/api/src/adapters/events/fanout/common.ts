/** @file common.ts @description Safe cross-instance notice format. @module events */
import type { Notice } from "../../../modules/events/dispatch/ports.ts";
export const validChannel = (v: string) =>
  /^\/(matches|match-invites|interviews|memberships|submissions)\/[0-9a-fA-F-]{36}$/.test(v);
export function safeNotice(channel: string, value: unknown): Notice {
  if (!validChannel(channel) || !value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid event notice");
  const n = value as Record<string, unknown>;
  const id = n.id ?? n.ID,
    aggregateId = n.aggregateId ?? n.AggregateID,
    version = n.version ?? n.Version,
    type = n.type ?? n.Type,
    occurredAt = n.occurredAt ?? n.OccurredAt;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 128 ||
    typeof aggregateId !== "string" ||
    !channel.endsWith(`/${aggregateId}`) ||
    typeof version !== "string" ||
    version.length > 32 ||
    typeof type !== "string" ||
    !type ||
    type.length > 128 ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    throw new Error("Invalid event notice");
  return { id, aggregateId, version, type, occurredAt: new Date(occurredAt).toISOString() };
}
export function wireNotice(channel: string, value: Notice) {
  const n = safeNotice(channel, value);
  return {
    ID: n.id,
    AggregateID: n.aggregateId,
    Version: n.version,
    Type: n.type,
    OccurredAt: n.occurredAt,
  };
}
export function endpoint(raw: string, socket = false): URL {
  const u = new URL(raw),
    local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === (socket ? "wss:" : "https:") ||
      (local && u.protocol === (socket ? "ws:" : "http:"))
    )
  )
    throw new Error("Invalid event endpoint");
  return u;
}
export function frameText(data: import("ws").RawData): string {
  return (
    Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
  ).toString("utf8");
}
