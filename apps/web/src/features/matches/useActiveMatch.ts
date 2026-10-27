/** @file useActiveMatch.ts @description Finds current server membership before exposing creation or return actions. @module matches */
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { api, requireData } from "../../api/client";
import { subscribeMembershipEvents } from "../realtime/membershipEvents";
import { activeMatchReturnLabel } from "./matchState";

export function useActiveMatch(identity: DevelopmentIdentity, enabled = true) {
  const [connection, setConnection] = useState<"connecting" | "ready" | "offline">("connecting");
  const query = useQuery({
    queryKey: ["current-match", identity],
    enabled,
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
    let generation = 0;
    let stopped = false;
    let fetching = false;
    let pending = false;
    async function synchronize() {
      pending = true;
      if (fetching) return;
      fetching = true;
      while (pending && !stopped) {
        pending = false;
        const attempt = generation;
        const result = await refresh();
        if (stopped || generation !== attempt) break;
        if (result.isError) {
          setConnection("offline");
          break;
        }
        if (!pending) setConnection("ready");
      }
      fetching = false;
      if (pending && !stopped) void synchronize();
    }
    const stop = subscribeMembershipEvents(identity, (event) => {
      if (event === "changed") void synchronize();
      else {
        generation++;
        pending = false;
        setConnection(event);
      }
    });
    return () => {
      stopped = true;
      generation++;
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
