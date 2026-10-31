/** @file match.ts @description Match event envelopes from canonical authorized snapshots. @module events */
import { ApplicationError } from "../../../application/error.ts";
import type { Lifecycle } from "../../matches/lifecycle/model.ts";
import type { SocketSnapshotSource } from "./ports.ts";
/** Read the current member-scoped match snapshot for every event and repair. */
export function matchSocketSnapshot(id: string, lifecycle: Lifecycle): SocketSnapshotSource {
  return {
    async read(principal) {
      if (!principal) throw new ApplicationError("unauthenticated", "Sign in required", 401);
      const value = await lifecycle.read(principal, id);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid match snapshot");
      const snapshot = value as {
        id?: unknown;
        version?: unknown;
        state?: unknown;
        serverNow?: unknown;
      };
      if (
        snapshot.id !== id ||
        typeof snapshot.version !== "string" ||
        !/^(0|[1-9]\d*)$/.test(snapshot.version) ||
        typeof snapshot.serverNow !== "string" ||
        !Number.isFinite(Date.parse(snapshot.serverNow))
      )
        throw new Error("Invalid match snapshot");
      const terminal = snapshot.state === "completed" || snapshot.state === "cancelled";
      return {
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          schemaVersion: 1,
          aggregateId: id,
          aggregateVersion: snapshot.version,
          type: terminal ? "match.completed" : "match.updated",
          occurredAt: snapshot.serverNow,
          payload: value,
        }),
        version: snapshot.version,
        terminal,
      };
    },
  };
}
