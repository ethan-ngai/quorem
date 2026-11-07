import { useQuery } from "@tanstack/react-query";
import type { TeamLobby } from "@quorem/contracts/factions";
import { partyRequest } from "../matches/party";

/** One roster query serves organization controls and match-start eligibility. */
export function useFactionLobby(id?: string, enabled = true) {
  return useQuery({
    queryKey: ["party-teams", id],
    enabled: !!id && enabled,
    queryFn: () => partyRequest<TeamLobby>(`/v1/parties/${id}/teams`),
    refetchInterval: 2000,
  });
}
