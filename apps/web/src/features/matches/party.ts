/** @file party.ts @description Persistent party commands and shared current-party state. @module matches */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DevelopmentIdentity, PartySettings, PartySnapshot } from "@quorem/contracts";
import { authenticatedFetch } from "../auth/session";
import { randomUUID } from "../../randomUUID";
import { recoverableCommand } from "./commandRecovery";
import { RejectedMatchCommand } from "./errors";

export type Party = PartySnapshot;
export type { PartySettings };
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
    if (response.status >= 400 && response.status < 500)
      throw new RejectedMatchCommand("Party request rejected.");
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
    refetchInterval: (query) => (poll && query.state.data?.party ? 3000 : false),
    queryFn: () => request<{ party: Party | null }>("/v1/parties/current"),
  });
}
/** Each tab renews its own lease; closing one window never revokes another. */
export function usePlatformPresence(identity: DevelopmentIdentity, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const windowId = randomUUID();
    const heartbeat = () => {
      void request<{ party: Party | null }>("/v1/presence/heartbeat", "POST", { windowId })
        .then((data) => client.setQueryData(["current-party", identity], data))
        .catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, identity, enabled]);
}
