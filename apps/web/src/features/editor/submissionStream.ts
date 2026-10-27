/** @file submissionStream.ts @description Owner-scoped submission socket and snapshot validation. @module editor */
import type { DevelopmentIdentity, Submission } from "@quorem/contracts";
import { createReconnectingSocket } from "../realtime/reconnectingSocket";

export function submissionStream(
  identity: DevelopmentIdentity,
  id: string,
  workspaceId: string,
  onSnapshot: (snapshot: Submission) => void,
  onDisconnect: () => void = () => {},
) {
  return createReconnectingSocket({
    url: () => {
      const url = new URL(
        `/v1/submissions/${encodeURIComponent(id)}/events`,
        import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("user", identity);
      return url;
    },
    timeout: 5000,
    idleTimeout: 30000,
    onOpen: () => {},
    onDisconnect,
    onMessage: (event) => {
      try {
        const value: unknown = JSON.parse(String(event.data));
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          value.id !== id ||
          !("workspaceId" in value) ||
          value.workspaceId !== workspaceId ||
          !("state" in value) ||
          typeof value.state !== "string" ||
          !["queued", "running", "completed", "cancelled", "failed"].includes(value.state) ||
          !("kind" in value) ||
          (value.kind !== "run" && value.kind !== "submit") ||
          !("sourceHash" in value) ||
          typeof value.sourceHash !== "string" ||
          !("admittedAt" in value) ||
          typeof value.admittedAt !== "string" ||
          !("updatedAt" in value) ||
          typeof value.updatedAt !== "string"
        )
          return;
        onSnapshot(value as Submission);
      } catch {
        /* Invalid frames never replace the last authorized snapshot. */
      }
    },
  });
}
