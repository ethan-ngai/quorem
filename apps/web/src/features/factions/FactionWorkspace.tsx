import { factionName } from "@quorem/contracts/factions";
/** @file FactionWorkspace.tsx @description Team collaboration composed into the common coding workspace. @module factions */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot, PublishedQuestion } from "@quorem/contracts";
import type { TeamSnapshot, TeamAction } from "@quorem/contracts/factions";
import type { CollaborationStatus } from "../collaboration/documentSync";
import { ownParticipant } from "../matches/matchState";
import { WorkspacePage } from "../editor/WorkspacePage";
import { WorkspaceRecovery } from "../../ui/WorkspaceRecovery";
import { LoadingIndicator } from "../../ui/Spinner";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { TeamVoteToast } from "./TeamVoteToast";
import { createTeamCollaboration } from "./collaboration";
import { teamRequest } from "./api";
import type { ReactNode } from "react";
export function FactionWorkspace({
  match,
  identity,
  header,
  review,
  reviewRequest,
}: {
  match: MatchSnapshot;
  identity: DevelopmentIdentity;
  header?: (problem: PublishedQuestion) => ReactNode;
  review?: boolean;
  reviewRequest?: { participantId: string };
}) {
  const query = useQuery({
    queryKey: ["team", match.id, identity],
    queryFn: () => teamRequest<TeamSnapshot>(match.id),
    enabled: !review,
    refetchInterval: 1000,
    retry: false,
  });
  // Keep the existing team editor during review, even if a team refresh was in flight.
  const liveTeam = useRef<TeamSnapshot>(undefined);
  if (!review) liveTeam.current = query.data;
  const team = review ? liveTeam.current : query.data;
  if (!team && review)
    return (
      <WorkspacePage
        match={match}
        matchWorkspaceId={ownParticipant(match, identity)?.workspaceId}
        identity={identity}
        matchHeader={header}
        review
        reviewRequest={reviewRequest}
      />
    );
  if (!team)
    return (
      <WorkspaceRecovery
        failed={query.isError}
        title="Opening faction workspace"
        message={query.isError ? "Could not connect to your faction." : "Connecting…"}
        onRetry={() => query.refetch()}
        backHref="/party"
        backLabel="Back to lobby"
      />
    );
  return (
    <TeamWorkspace
      key={team.document.epoch}
      initial={team}
      snapshot={team}
      match={match}
      identity={identity}
      header={header}
      review={review}
      reviewRequest={reviewRequest}
    />
  );
}
function TeamWorkspace({
  initial,
  snapshot,
  match,
  identity,
  header,
  review,
  reviewRequest,
}: {
  initial: TeamSnapshot;
  snapshot: TeamSnapshot;
  match: MatchSnapshot;
  identity: DevelopmentIdentity;
  header?: (problem: PublishedQuestion) => ReactNode;
  review?: boolean;
  reviewRequest?: { participantId: string };
}) {
  const client = useQueryClient();
  // Source and collaboration version must come from the same snapshot until this epoch remounts.
  const [seed] = useState(initial);
  const [status, setStatus] = useState<CollaborationStatus>("connecting");
  const [error, setError] = useState<string>();
  const controller = useMemo(
    () => createTeamCollaboration(match.id, seed, setStatus),
    [match.id, seed],
  );
  useEffect(() => controller.update(snapshot), [controller, snapshot]);
  const refresh = () => client.invalidateQueries({ queryKey: ["team", match.id, identity] });
  async function propose(action: TeamAction | { kind: "submit" }) {
    await teamRequest(match.id, "propose", { action });
    await refresh();
  }
  async function documentAction(kind: "reset" | "language", language?: string) {
    if (!(await controller.flush())) throw new Error("Wait for your edits to synchronize");
    const current = await teamRequest<TeamSnapshot>(match.id);
    const position = {
      documentEpoch: current.document.epoch,
      documentVersion: current.document.version,
    };
    await propose(
      kind === "language" ? { kind, language: language!, ...position } : { kind, ...position },
    );
  }
  async function action(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Faction action failed");
    }
  }
  const activeVote = snapshot.votes.find((v) => v.state === "pending");
  return (
    <WorkspacePage
      match={match}
      matchWorkspaceId={snapshot.workspaceId}
      identity={identity}
      review={review}
      reviewRequest={reviewRequest}
      sharedDocument={{
        updateOdyssey: controller.updateOdyssey,
        source: seed.document.source,
        extension: controller.extension,
        latestSubmissionId: snapshot.latestSubmissionId,
        beforeExecution: async () => {
          if (!(await controller.flush())) throw new Error("Wait for your edits to synchronize");
          return true;
        },
        requestPaidAction: async (request) => {
          if (!(await controller.flush())) throw new Error("Wait for your edits to synchronize");
          await propose(
            request.kind === "submission"
              ? { kind: "submit" }
              : {
                  kind: "reveal",
                  target: request.kind === "hiddenCase" ? "case" : request.kind,
                  ...(request.submissionId
                    ? { submissionId: request.submissionId, caseIndex: request.caseIndex }
                    : {}),
                },
          );
        },
        changeLanguage: (language) => documentAction("language", language),
      }}
      matchHeader={(problem) =>
        review ? (
          header?.(problem)
        ) : (
          <>
            {header?.(problem)}
            <div className="faction-toolbar">
              <strong>{factionName(snapshot.team, match.factionNames)}</strong>
              <span>{snapshot.members.map((m) => m.name).join(", ")}</span>
              {status === "replaced" ? (
                <span role="status">Document replaced</span>
              ) : status !== "connected" ? (
                <LoadingIndicator label={status === "offline" ? "Reconnecting…" : "Syncing…"} />
              ) : null}
              <button
                className="quiet-button"
                disabled={match.state !== "active"}
                onClick={() => void action(() => documentAction("reset"))}
              >
                Reset code
              </button>
              <button
                className="quiet-button"
                disabled={match.state !== "active"}
                onClick={() => void action(() => propose({ kind: "concede" }))}
              >
                Concede
              </button>
              <PersistentNotice message={error} />
              {activeVote && (
                <TeamVoteToast
                  key={activeVote.id}
                  vote={activeVote}
                  identity={identity}
                  proposerName={
                    snapshot.members.find((m) => m.userId === activeVote.proposerId)?.name ??
                    "Faction member"
                  }
                  serverNow={snapshot.serverNow}
                  onVote={async (id, approve) => {
                    await teamRequest(match.id, "vote", { id, approve });
                    await refresh();
                  }}
                  onCancel={async (id) => {
                    await teamRequest(match.id, "cancel", { id });
                    await refresh();
                  }}
                />
              )}
            </div>
          </>
        )
      }
    />
  );
}
