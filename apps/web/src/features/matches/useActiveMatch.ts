/** @file useActiveMatch.ts @description Finds current server membership before exposing creation or return actions. @module matches */
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { activeMatchReturnLabel } from "./matchState";

export function useActiveMatch(identity: DevelopmentIdentity, enabled = true) {
  const query = useQuery({
    queryKey: ["current-match", identity],
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
    failed: enabled && query.isError,
    refresh: query.refetch,
  };
}
