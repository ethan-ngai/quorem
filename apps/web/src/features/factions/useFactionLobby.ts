import { useQuery } from "@tanstack/react-query";
import { factionLobby } from "./api";

/** One roster query serves organization controls and match-start eligibility. */
export function useFactionLobby(id?: string, enabled = true) {
  return useQuery({
    queryKey: ["party-teams", id],
    enabled: !!id && enabled,
    queryFn: () => factionLobby(id!),
    refetchInterval: 2000,
  });
}
