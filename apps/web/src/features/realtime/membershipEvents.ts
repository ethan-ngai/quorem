/** @file membershipEvents.ts @description Shared authenticated owner membership invalidations. @module realtime */
import type { DevelopmentIdentity } from "@quorem/contracts";
import { createReconnectingSocket } from "./reconnectingSocket";

type MembershipEvent = "connecting" | "changed" | "offline";
type Listener = (event: MembershipEvent) => void;
const subscriptions = new Map<
  string,
  { listeners: Set<Listener>; stop(): void; state: MembershipEvent }
>();

/** Reuse one socket per account; each subscriber reloads its authorized snapshot. */
export function subscribeMembershipEvents(identity: DevelopmentIdentity, listener: Listener) {
  let entry = subscriptions.get(identity);
  if (!entry) {
    const listeners = new Set<Listener>();
    const current = { listeners, state: "connecting" as MembershipEvent, stop: () => {} };
    const emit = (event: MembershipEvent) => {
      current.state = event;
      for (const subscriber of listeners) subscriber(event);
    };
    const socket = createReconnectingSocket({
      url: () => {
        const url = new URL(
          "/v1/memberships/events",
          import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        if (["alice", "bob", "charlie", "dana"].includes(identity))
          url.searchParams.set("user", identity);
        return url;
      },
      timeout: 5000,
      idleTimeout: 45000,
      onConnecting: () => emit("connecting"),
      onOpen: () => {},
      onMessage: (event) => {
        let value: unknown;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          socket.current?.close();
          return;
        }
        if (!value || typeof value !== "object" || !("type" in value)) {
          socket.current?.close();
          return;
        }
        if (value.type === "heartbeat") return;
        if (value.type !== "membership.updated") {
          socket.current?.close();
          return;
        }
        emit("changed");
      },
      onDisconnect: () => emit("offline"),
    });
    current.stop = () => socket.stop();
    subscriptions.set(identity, current);
    entry = current;
    listeners.add(listener);
    socket.start();
  } else {
    entry.listeners.add(listener);
    listener(entry.state);
  }
  const subscribed = entry;
  return () => {
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size === 0 && subscriptions.get(identity) === subscribed) {
      subscribed.stop();
      subscriptions.delete(identity);
    }
  };
}
