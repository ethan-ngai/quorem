/** @file useMatchSync.ts @description Owner-scoped browser synchronization for one match. @module realtime */
import { api, ApiError, requireData } from "../../api/client";
import { isRouteDenied } from "../auth/protectedRoute";
import { isMatchTerminal } from "../matches/matchState";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { isMatchSnapshot, keepNewestSnapshot, parseMatchEvent } from "./matchSync";
import { createReconnectingSocket } from "./reconnectingSocket";

export type MatchSyncStatus = "connecting" | "live" | "reconnecting";

const recoveryInterval = 2_000;
const snapshotTimeout = 5_000;

function isAccessError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || isRouteDenied(error.status));
}

function eventSocketUrl(matchId: string, identity: DevelopmentIdentity) {
  const base = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
  const url = new URL(`/v1/matches/${encodeURIComponent(matchId)}/events`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("user", identity);
  return url.toString();
}

async function fetchMatchSnapshot(
  identity: DevelopmentIdentity,
  matchId: string,
  signal: AbortSignal,
): Promise<MatchSnapshot> {
  const { data, error, response } = await api(identity).GET("/v1/matches/{id}", {
    params: { path: { id: matchId } },
    signal,
  });
  const snapshot = requireData(data, error, response.status);
  if (!isMatchSnapshot(snapshot, matchId))
    throw new Error("Match response did not match the contract");
  return snapshot;
}

/** Keeps one owner-scoped match snapshot synchronized over events and REST recovery. */
export function useMatchSync(
  identity: DevelopmentIdentity,
  matchId: string | undefined,
  enabled = true,
): {
  snapshot: MatchSnapshot | undefined;
  error: Error | null;
  status: MatchSyncStatus;
  refetch: () => Promise<unknown>;
} {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["match", identity, matchId] as const, [identity, matchId]);
  const [connection, setConnection] = useState<{
    key: typeof queryKey;
    status: MatchSyncStatus;
  }>();
  const status = connection?.key === queryKey ? connection.status : "connecting";

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!matchId) throw new Error("Match id is required");
      return fetchMatchSnapshot(identity, matchId, signal);
    },
    enabled: enabled && Boolean(matchId),
    retry: (failureCount, error) => failureCount < 1 && !isAccessError(error),
    refetchInterval: ({ state: { data, error } }) => {
      const needsRefresh = isMatchTerminal(data) ? data?.reviewPending : status === "reconnecting";
      return needsRefresh && !isAccessError(error) ? recoveryInterval : false;
    },
    structuralSharing: (previous, incoming) =>
      keepNewestSnapshot(previous as MatchSnapshot | undefined, incoming as MatchSnapshot),
  });

  const accessFailed = isAccessError(query.error);
  // A new visit can regain access after being invited or switching sessions.
  const deniedThisVisit = accessFailed && query.isFetchedAfterMount;
  const terminal = isMatchTerminal(query.data);
  // The authorized HTTP snapshot decides whether this visit needs a live socket.
  const connect = enabled && !!matchId && !!query.data && !terminal && !accessFailed;

  useEffect(() => {
    if (!connect || !matchId) return;
    let currentStatus: MatchSyncStatus = "connecting";
    let firstSnapshotTimer: number | undefined;
    setConnection({ key: queryKey, status: currentStatus });

    function setStatus(next: MatchSyncStatus) {
      if (next === currentStatus) return;
      currentStatus = next;
      setConnection({ key: queryKey, status: next });
    }

    const socket = createReconnectingSocket({
      url: () => eventSocketUrl(matchId, identity),
      timeout: 2_000,
      idleTimeout: 45_000,
      onOpen() {
        // A transport handshake does not guarantee the server has delivered match state.
        window.clearTimeout(firstSnapshotTimer);
        firstSnapshotTimer = window.setTimeout(() => setStatus("reconnecting"), snapshotTimeout);
      },
      onMessage(message) {
        const event = parseMatchEvent(JSON.parse(String(message.data)), matchId);
        if (!event) {
          setStatus("reconnecting");
          return;
        }
        if (isAccessError(queryClient.getQueryState(queryKey)?.error)) return;
        window.clearTimeout(firstSnapshotTimer);
        // Frames carry full snapshots. Version ordering also fences late HTTP responses.
        queryClient.setQueryData(queryKey, event.payload);
        setStatus("live");
      },
      onComplete() {
        window.clearTimeout(firstSnapshotTimer);
        if (!isMatchTerminal(queryClient.getQueryData<MatchSnapshot>(queryKey))) {
          setStatus("reconnecting");
        }
      },
      onDisconnect() {
        window.clearTimeout(firstSnapshotTimer);
        setStatus("reconnecting");
      },
    });
    socket.start();
    return () => {
      socket.stop();
      window.clearTimeout(firstSnapshotTimer);
    };
  }, [identity, matchId, queryClient, queryKey, connect]);

  return {
    snapshot: deniedThisVisit ? undefined : query.data,
    error: accessFailed && !deniedThisVisit ? null : query.error,
    status,
    refetch: query.refetch,
  };
}
