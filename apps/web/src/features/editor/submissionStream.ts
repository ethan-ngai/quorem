/** @file submissionStream.ts @description Owner-scoped submission socket and snapshot validation. @module editor */
import type { DevelopmentIdentity } from "@quorem/contracts";
import { createReconnectingSocket } from "../realtime/reconnectingSocket";

export function submissionStream(
  identity: DevelopmentIdentity,
  id: string,
  onChange: () => void,
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
    onOpen: onChange,
    onDisconnect,
    onMessage: (event) => {
      try {
        const value: unknown = JSON.parse(String(event.data));
        if (value && typeof value === "object" && "type" in value && value.type === "changed")
          onChange();
      } catch {
        /* Invalid notices never change the cached result. */
      }
    },
  });
}
