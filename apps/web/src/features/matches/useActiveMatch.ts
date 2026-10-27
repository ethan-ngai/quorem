/** @file useActiveMatch.ts @description Finds current server membership before exposing creation or return actions. @module matches */
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { api, requireData } from "../../api/client";
import { membershipSynchronizer, subscribeMembershipEvents } from "../realtime/membershipEvents";
import { activeMatchReturnLabel } from "./matchState";

export function useActiveMatch(identity: DevelopmentIdentity, enabled = true) {
  const [connection, setConnection] = useState<"connecting" | "ready" | "offline">("connecting");
  const query = useQuery({
    queryKey: ["current-match", identity],
    // The subscription's first invalidation fences the initial snapshot.
    enabled: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await api(identity).GET("/v1/matches/current", { signal });
      return requireData(data as MatchSnapshot | null | undefined, error);
    },
    retry: false,
    staleTime: 0,
  });
  const refresh = query.refetch;
  useEffect(() => {
    if (!enabled) return;
    const sync = membershipSynchronizer(() => refresh({ cancelRefetch: false }), setConnection);
    const stop = subscribeMembershipEvents(identity, (event) => sync.event(event));
    return () => {
      sync.stop();
      stop();
    };
  }, [identity, enabled, refresh]);
  const label = query.data ? activeMatchReturnLabel(query.data, identity) : null;
  return {
    match: enabled && connection === "ready" && !query.isError && label ? query.data : null,
    label,
    checking: enabled && connection === "connecting",
    failed: enabled && (connection === "offline" || query.isError),
    refresh,
  };
}
