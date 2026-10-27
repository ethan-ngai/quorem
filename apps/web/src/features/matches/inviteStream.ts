/** @file inviteStream.ts @description Token-scoped invitation notice and liveness handling. @module matches */
import { createReconnectingSocket } from "../realtime/reconnectingSocket";

/** Reconnect silent streams; only change notices refresh the authorized preview. */
export function inviteStream(token: string, onChange: () => void) {
  let opened = false;
  return createReconnectingSocket({
    url: () => {
      const url = new URL(
        `/v1/match-invites/${encodeURIComponent(token)}/events`,
        window.location.origin,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url;
    },
    timeout: 2000,
    authenticate: false,
    idleTimeout: 45_000,
    onOpen() {
      opened = true;
    },
    onDisconnect() {
      if (opened) {
        opened = false;
        onChange();
      }
    },
    onMessage(event) {
      try {
        const notice: unknown = JSON.parse(String(event.data));
        if (notice && typeof notice === "object" && "type" in notice && notice.type === "changed")
          onChange();
      } catch {
        /* A malformed frame cannot change the preview. */
      }
    },
  });
}
