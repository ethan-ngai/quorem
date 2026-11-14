/** @file useActiveMatch.ts @description Finds current server membership before exposing creation or return actions. @module matches */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { activeMatchReturnLabel } from "./matchState";

export const currentMatchQueryKey = (identity: DevelopmentIdentity, roundId?: string | null) =>
  roundId
    ? (["current-match", identity, roundId] as const)
    : (["current-match", identity] as const);

export function useActiveMatch(
  identity: DevelopmentIdentity,
  enabled = true,
  roundId?: string | null,
) {
  const query = useQuery({
    queryKey: currentMatchQueryKey(identity, roundId),
    enabled,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const { data, error } = await api(identity).GET("/v1/matches/current", { signal });
      return requireData(data as MatchSnapshot | null | undefined, error);
    },
    retry: false,
    staleTime: 0,
  });
  const label = query.data ? activeMatchReturnLabel(query.data, identity) : null;
  return {
    match: enabled && !query.isError && label ? query.data : null,
    label,
    checking: enabled && query.isPending,
    confirmed: enabled && query.isSuccess,
    failed: enabled && query.isError,
    refresh: query.refetch,
  };
}

/**
 * Opens the lobby's round once the server confirms the viewer is playing.
 * @returns Whether the viewer is confirmed to be waiting for the next round.
 */
export function usePartyRoundNavigation(
  identity: DevelopmentIdentity,
  roundId: string | null | undefined,
) {
  const navigate = useNavigate();
  // A cached pre-round response cannot establish membership in the new round.
  const activeMatch = useActiveMatch(identity, !!roundId, roundId);
  const destination = activeMatch.match?.id === roundId ? roundId : null;
  useEffect(() => {
    if (destination) void navigate({ to: "/match/$id", params: { id: destination } });
  }, [destination, navigate]);
  return !!roundId && activeMatch.confirmed && !destination;
}
