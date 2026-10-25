import { createReconnectingSocket } from "./reconnectingSocket";
/** @file useMatchSync.ts @description Owner-scoped browser synchronization for one match. @module realtime */
import { api, requireData } from "../../api/client";
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bufferMatchEvent,
  isMatchSnapshot,
  keepNewestSnapshot,
  mergeMatchEvents,
  parseMatchEvent,
  type MatchEventBuffer,
} from "./matchSync";

export type MatchSyncStatus = "connecting" | "live" | "polling";
type MatchSyncState = MatchEventBuffer & {
  disposed: boolean;
  fetching: boolean;
  gapTimer: number | undefined;
};

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
  const { data, error } = await api(identity).GET("/v1/matches/{id}", {
    params: { path: { id: matchId } },
    signal,
  });
  requireData(data, error);
  if (!isMatchSnapshot(data, matchId)) throw new Error("Match response did not match the contract");
  return data;
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
  const ownerKey = matchId ? `${identity}:${matchId}` : "";
  const syncState = useMemo<MatchSyncState>(
    () => ({ events: [], overflow: false, disposed: false, fetching: false, gapTimer: undefined }),
    [ownerKey],
  );
  const [status, setStatus] = useState<MatchSyncStatus>("connecting");
  const [readyOwner, setReadyOwner] = useState("");
  const [transportError, setTransportError] = useState<Error | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!matchId) throw new Error("Match id is required");
      syncState.fetching = true;
      try {
        const snapshot = await fetchMatchSnapshot(identity, matchId, signal);
        if (signal.aborted || syncState.disposed)
          throw new DOMException("Match query was cancelled", "AbortError");
        const overflowed = syncState.overflow;
        const buffered = syncState.events.splice(0);
        syncState.overflow = false;
        if (overflowed) {
          scheduleRecovery();
          return snapshot;
        }
        const merged = mergeMatchEvents(snapshot, buffered);
        if (merged.gap) scheduleRecovery();
        return merged.snapshot;
      } finally {
        syncState.fetching = false;
      }
    },
    enabled: enabled && Boolean(matchId) && readyOwner === ownerKey,
    refetchInterval: enabled ? (status === "live" ? 5_000 : 2_000) : false,
    structuralSharing: (previous, incoming) =>
      keepNewestSnapshot(previous as MatchSnapshot | undefined, incoming as MatchSnapshot),
  });

  function scheduleRecovery() {
    window.clearTimeout(syncState.gapTimer);
    syncState.gapTimer = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey });
    }, 0);
  }

  const refetch = useCallback(() => query.refetch(), [query.refetch]);

  useEffect(() => {
    if (!matchId || !enabled) {
      setReadyOwner("");
      setStatus("connecting");
      syncState.disposed = true;
      syncState.events = [];
      syncState.overflow = false;
      return;
    }

    setReadyOwner("");
    syncState.disposed = false;
    let disposed = false;

    const requestRefresh = () => {
      if (!disposed)
        void refetch().catch((cause: unknown) => {
          if (!disposed)
            setTransportError(
              cause instanceof Error ? cause : new Error("Could not refresh match"),
            );
        });
    };

    const connection = createReconnectingSocket({
      url: () => eventSocketUrl(matchId, identity),
      timeout: 2_000,
      onConnecting: () => setStatus("connecting"),
      onOpen() {
        setTransportError(null);
        setStatus("live");
        setReadyOwner(ownerKey);
        requestRefresh();
      },
      onMessage(message) {
        if (disposed) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(message.data)) as unknown;
        } catch {
          setTransportError(new Error("Match event was not valid JSON"));
          return;
        }
        const event = parseMatchEvent(raw, matchId);
        if (!event) {
          setTransportError(new Error("Match event did not match the contract"));
          return;
        }
        if (syncState.fetching) {
          bufferMatchEvent(syncState, event);
          return;
        }
        const previous = queryClient.getQueryData<MatchSnapshot>(queryKey);
        if (!previous) {
          bufferMatchEvent(syncState, event);
          requestRefresh();
          return;
        }
        const merged = mergeMatchEvents(previous, [event]);
        if (merged.gap) {
          void queryClient.invalidateQueries({ queryKey });
        } else if (merged.snapshot !== previous) {
          queryClient.setQueryData<MatchSnapshot>(queryKey, (current) =>
            current ? keepNewestSnapshot(current, merged.snapshot) : merged.snapshot,
          );
        }
      },
      onError(cause) {
        setTransportError(
          cause instanceof Error ? cause : new Error("Match event connection failed"),
        );
      },
      onDisconnect() {
        setStatus("polling");
        setReadyOwner(ownerKey);
      },
    });
    connection.start();
    return () => {
      disposed = true;
      syncState.disposed = true;
      connection.stop();
      window.clearTimeout(syncState.gapTimer);
      syncState.events = [];
      syncState.overflow = false;
    };
  }, [identity, matchId, ownerKey, queryClient, queryKey, refetch, syncState, enabled]);

  return {
    snapshot: query.data,
    error: transportError ?? (query.error instanceof Error ? query.error : null),
    status,
    refetch,
  };
}
