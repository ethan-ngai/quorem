import { useQuery } from "@tanstack/react-query";
import { factionLobby } from "./api";

export const factionLobbyKey = (id?: string) => ["party-teams", id] as const;

/** One roster query serves organization controls and match-start eligibility. */
export function useFactionLobby(id?: string, enabled = true) {
  return useQuery({
    queryKey: factionLobbyKey(id),
    enabled: !!id && enabled,
    queryFn: () => factionLobby(id!),
  });
}
