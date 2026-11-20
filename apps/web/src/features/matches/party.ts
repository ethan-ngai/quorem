/** @file party.ts @description Persistent party commands and shared current-party state. @module matches */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DevelopmentIdentity, PartySettings, PartySnapshot } from "@quorem/contracts";
import { authenticatedFetch } from "../auth/session";
import { randomUUID } from "../../randomUUID";
import { recoverableCommand } from "./commandRecovery";
import { RejectedMatchCommand } from "./errors";
import { safeErrorMessage } from "../../api/safeError";
import { createReconnectingSocket } from "../realtime/reconnectingSocket";
import { factionLobbyKey } from "../factions/useFactionLobby";

export type Party = PartySnapshot;
export type { PartySettings };
const invitationKey = (partyId: string) => `quorem.party-invite.v1:${partyId}`;
const membershipDenied = (error: unknown) =>
  error instanceof RejectedMatchCommand && [401, 403, 404, 410].includes(error.status ?? 0);

export function savePartyInvitation(partyId: string, path: string) {
  try {
    localStorage.setItem(invitationKey(partyId), path);
  } catch {
    // Storage restrictions must not prevent entering the lobby.
  }
}

export function readPartyInvitation(partyId: string) {
  try {
    const path = localStorage.getItem(invitationKey(partyId));
    if (!path) return;
    const url = new URL(path, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/invite/"))
      return url.href;
  } catch {
    // The lobby still works when the saved link is unavailable.
  }
}

const origin = () => import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
async function request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  const response = await authenticatedFetch(new URL(path, origin()), {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "Idempotency-Key": key ?? randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      const failure = await response.json().catch(() => null);
      throw new RejectedMatchCommand(
        safeErrorMessage(failure?.error?.code, failure?.error?.message) ??
          "Could not update the lobby.",
        response.status,
      );
    }
    throw new Error("Party request failed");
  }
  return (await response.json()) as T;
}
export const partyRequest = request;
export function partyCommand<T>(
  identity: DevelopmentIdentity,
  path: string,
  method = "POST",
  body?: unknown,
) {
  return recoverableCommand(
    identity,
    `party:${path}`,
    body ?? {},
    (payload, key) => request<T>(path, method, body === undefined ? undefined : payload, key),
    true,
  );
}
export function useParty(
  identity: DevelopmentIdentity,
  enabled = true,
  poll = false,
  { refetchOnMount = true }: { refetchOnMount?: boolean } = {},
) {
  return useQuery({
    queryKey: ["current-party", identity],
    enabled,
    retry: false,
    refetchOnMount,
    refetchInterval: (query) => {
      const party = query.state.data?.party;
      if (!poll || !party || membershipDenied(query.state.error)) return false;
      if (!party.countdownEndsAt) return 3000;
      // Reading the party at the deadline lets the server reconcile the round immediately.
      const remaining = Date.parse(party.countdownEndsAt) - Date.now();
      return remaining > 0 ? Math.min(3000, remaining) : 500;
    },
    queryFn: () => request<{ party: Party | null }>("/v1/parties/current"),
  });
}
/** Follow lobby snapshots while membership exists and recover through the shared query on disconnect. */
export function useLiveParty(identity: DevelopmentIdentity, enabled: boolean) {
  const client = useQueryClient();
  const [live, setLive] = useState<{ identity: DevelopmentIdentity; id: string }>();
  const query = useParty(identity, enabled, live?.identity !== identity);
  const id = enabled && !membershipDenied(query.error) ? query.data?.party?.id : undefined;
  const factionVersion =
    query.data?.party?.settings?.mode === "factions" ? query.data.party.version : undefined;
  useEffect(() => {
    if (id && factionVersion !== undefined)
      void client.invalidateQueries({ queryKey: factionLobbyKey(id), exact: true });
  }, [client, id, factionVersion]);
  useEffect(() => {
    if (!id) return;
    const key = ["current-party", identity] as const;
    const socket = createReconnectingSocket({
      url: () => {
        const url = new URL(`/v1/parties/${encodeURIComponent(id)}/events`, origin());
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        return url;
      },
      timeout: 5_000,
      idleTimeout: 45_000,
      onOpen() {},
      onMessage(event) {
        const frame = JSON.parse(String(event.data)) as { type?: string; party?: Party };
        const party = frame.party;
        if (frame.type !== "party.snapshot" || party?.id !== id || !/^\d+$/.test(party.version))
          return;
        client.setQueryData<{ party: Party | null }>(key, (current) => {
          const previous = current?.party;
          if (!previous || previous.id !== id || BigInt(previous.version) > BigInt(party.version))
            return current;
          return { party };
        });
        setLive((current) =>
          current?.identity === identity && current.id === id ? current : { identity, id },
        );
      },
      onDisconnect() {
        setLive(undefined);
        void client.invalidateQueries({ queryKey: key, exact: true });
      },
    });
    socket.start();
    return () => {
      socket.stop();
      setLive((current) => (current?.id === id ? undefined : current));
    };
  }, [client, identity, id]);
  return query;
}
