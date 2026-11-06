import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchReview, Workspace } from "@quorem/contracts";
import { authenticatedFetch } from "../auth/session";
import type { EditorLanguage } from "../editor/editorLanguages";

export async function createReviewWorkspace(
  matchId: string,
  participantUserId: string,
  language: EditorLanguage,
) {
  const response = await authenticatedFetch(
    new URL(
      `/v1/matches/${encodeURIComponent(matchId)}/review/workspaces`,
      import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantUserId, language }),
    },
  );
  if (!response.ok) throw new Error("Could not open review draft.");
  return response.json() as Promise<Workspace>;
}

export function useMatchReview(
  identity: DevelopmentIdentity,
  matchId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["match-review", identity, matchId],
    enabled: enabled && !!matchId,
    retry: false,
    queryFn: async () => {
      const response = await authenticatedFetch(
        new URL(
          `/v1/matches/${encodeURIComponent(matchId!)}/review`,
          import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
        ),
      );
      if (!response.ok)
        throw new Error("Review unavailable. It may have expired or you may not have access.");
      return response.json() as Promise<MatchReview>;
    },
  });
}
