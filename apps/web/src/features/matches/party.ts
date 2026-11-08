/** @file party.ts @description Persistent party commands and shared current-party state. @module matches */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DevelopmentIdentity, PartySettings, PartySnapshot } from "@quorem/contracts";
import { authenticatedFetch } from "../auth/session";
import { randomUUID } from "../../randomUUID";
import { recoverableCommand } from "./commandRecovery";
import { RejectedMatchCommand } from "./errors";
import { safeErrorMessage } from "../../api/safeError";

export type Party = PartySnapshot;
export type { PartySettings };
const invitationKey = (partyId: string) => `quorem.party-invite.v1:${partyId}`;

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
export function useParty(identity: DevelopmentIdentity, enabled = true, poll = false) {
  return useQuery({
    queryKey: ["current-party", identity],
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const party = query.state.data?.party;
      if (!poll || !party) return false;
      if (!party.countdownEndsAt) return 3000;
      // Reading the party at the deadline lets the server reconcile the round immediately.
      const remaining = Date.parse(party.countdownEndsAt) - Date.now();
      return remaining > 0 ? Math.min(3000, remaining) : 500;
    },
    queryFn: () => request<{ party: Party | null }>("/v1/parties/current"),
  });
}
/** Each tab renews its own lease; closing one window never revokes another. */
export function usePlatformPresence(identity: DevelopmentIdentity, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const windowId = randomUUID();
    let active = true;
    const heartbeat = () => {
      const key = ["current-party", identity] as const;
      const previous = client.getQueryData<{ party: Party | null }>(key);
      const revision = client.getQueryState(key)?.dataUpdateCount;
      void request<{ party: Party | null }>("/v1/presence/heartbeat", "POST", { windowId })
        .then((data) => {
          // A command or newer heartbeat may have already refreshed membership.
          if (!active || client.getQueryState(key)?.dataUpdateCount !== revision) return;
          const current = previous?.party;
          const next = data.party;
          if (
            current &&
            next &&
            current.id === next.id &&
            /^\d+$/.test(current.version) &&
            /^\d+$/.test(next.version) &&
            BigInt(current.version) > BigInt(next.version)
          )
            return;
          client.setQueryData(key, data);
        })
        .catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, identity, enabled]);
}
