import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchReview, Workspace } from "@quorem/contracts";
import { authenticatedFetch } from "../auth/session";
import type { EditorLanguage } from "../editor/editorLanguages";

type ReviewParticipant = MatchReview["participants"][number];

export function reviewCodeLanguage(participant?: ReviewParticipant) {
  return (participant?.finalCode?.language ??
    (participant?.submission?.winning ? participant.submission.language : undefined) ??
    participant?.workspace?.language ??
    participant?.submission?.language) as EditorLanguage | undefined;
}

export function initialReviewSource(
  participant: ReviewParticipant,
  language: EditorLanguage,
  readOwnDraft: () => string | undefined,
) {
  const code = participant.finalCode ?? participant.submission;
  if ((participant.finalCode || participant.submission?.winning) && code?.language === language)
    return code.source;
  const draft =
    participant.own && participant.workspace?.language === language ? readOwnDraft() : undefined;
  return draft ?? (code?.language === language ? code.source : undefined);
}

export async function saveMatchReviewCode(matchId: string, workspaceId: string, source: string) {
  const body = JSON.stringify({ workspaceId, source });
  const response = await authenticatedFetch(
    new URL(
      `/v1/matches/${encodeURIComponent(matchId)}/review/code`,
      import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: new TextEncoder().encode(body).length < 60_000,
      signal: AbortSignal.timeout(3000),
    },
  );
  if (!response.ok && response.status !== 409)
    throw new Error("Could not save code for match review.");
}

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
