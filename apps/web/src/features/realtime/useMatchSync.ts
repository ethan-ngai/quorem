import {
  createApiClient,
  type DevelopmentIdentity,
  type EventEnvelope,
  type MatchSnapshot,
} from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createReconnectScheduler,
  isMatchSnapshot,
  keepNewestSnapshot,
  mergeMatchEvents,
  parseMatchEvent,
} from "./matchSync";

export type MatchSyncStatus = "connecting" | "live" | "polling";

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
}

function eventSocketUrl(matchId: string, identity: DevelopmentIdentity) {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
  const url = new URL(`/v1/matches/${encodeURIComponent(matchId)}/events`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("user", identity);
  return url.toString();
}

async function fetchMatchSnapshot(
  identity: DevelopmentIdentity,
  matchId: string,
): Promise<MatchSnapshot> {
  const { data, error } = await createApiClient({ baseUrl: apiBaseUrl(), identity }).GET(
    "/v1/matches/{id}",
    {
      params: { path: { id: matchId } },
    },
  );
  if (data === undefined) {
    const message =
      typeof error === "object" && error !== null && "error" in error
        ? String((error as { error: { message?: string } }).error.message ?? "Could not load match")
        : "Could not load match";
    throw new Error(message);
  }
  if (!isMatchSnapshot(data, matchId)) throw new Error("Match response did not match the contract");
  return data;
}

/** Keeps one owner-scoped match snapshot synchronized over events and REST recovery. */
export function useMatchSync(
  identity: DevelopmentIdentity,
  matchId: string | undefined,
): {
  snapshot: MatchSnapshot | undefined;
  error: Error | null;
  status: MatchSyncStatus;
  refetch: () => Promise<unknown>;
} {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["match", identity, matchId] as const, [identity, matchId]);
  const ownerKey = matchId ? `${identity}:${matchId}` : "";
  const [status, setStatus] = useState<MatchSyncStatus>("connecting");
  const [readyOwner, setReadyOwner] = useState("");
  const [transportError, setTransportError] = useState<Error | null>(null);
  const queuedEvents = useRef<EventEnvelope[]>([]);
  const fetching = useRef(false);
  const gapTimer = useRef<number | undefined>(undefined);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!matchId) throw new Error("Match id is required");
      fetching.current = true;
      try {
        const snapshot = await fetchMatchSnapshot(identity, matchId);
        const buffered = queuedEvents.current.splice(0);
        const merged = mergeMatchEvents(snapshot, buffered);
        if (merged.gap) {
          window.clearTimeout(gapTimer.current);
          gapTimer.current = window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey });
          }, 0);
        }
        return merged.snapshot;
      } finally {
        fetching.current = false;
      }
    },
    enabled: Boolean(matchId) && readyOwner === ownerKey,
    refetchInterval: status === "live" ? 5_000 : 2_000,
    structuralSharing: (previous, incoming) =>
      keepNewestSnapshot(previous as MatchSnapshot | undefined, incoming as MatchSnapshot),
  });

  const refetch = useCallback(() => query.refetch(), [query.refetch]);

  useEffect(() => {
    if (!matchId) {
      setReadyOwner("");
      setStatus("connecting");
      queuedEvents.current = [];
      return;
    }

    setReadyOwner("");
    let disposed = false;
    let socket: WebSocket | undefined;
    let connectTimer: number | undefined;

    const requestRefresh = () => {
      if (!disposed)
        void refetch().catch((cause: unknown) => {
          if (!disposed)
            setTransportError(
              cause instanceof Error ? cause : new Error("Could not refresh match"),
            );
        });
    };

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      try {
        socket = new WebSocket(eventSocketUrl(matchId, identity));
      } catch (cause) {
        setTransportError(
          cause instanceof Error ? cause : new Error("Match event connection failed"),
        );
        setStatus("polling");
        setReadyOwner(ownerKey);
        reconnect.schedule();
        return;
      }

      connectTimer = window.setTimeout(() => {
        if (!disposed && socket?.readyState !== WebSocket.OPEN) {
          setStatus("polling");
          setReadyOwner(ownerKey);
          socket?.close();
        }
      }, 2_000);

      socket.onopen = () => {
        if (disposed) return;
        window.clearTimeout(connectTimer);
        reconnect.reset();
        setTransportError(null);
        setStatus("live");
        setReadyOwner(ownerKey);
        requestRefresh();
      };

      socket.onmessage = (message) => {
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
        if (fetching.current) {
          queuedEvents.current.push(event);
          return;
        }
        const previous = queryClient.getQueryData<MatchSnapshot>(queryKey);
        if (!previous) {
          queuedEvents.current.push(event);
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
      };

      socket.onerror = () => {
        if (!disposed) {
          setTransportError(new Error("Match event connection failed"));
          socket?.close();
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        window.clearTimeout(connectTimer);
        setStatus("polling");
        setReadyOwner(ownerKey);
        reconnect.schedule();
      };
    };

    const reconnect = createReconnectScheduler(
      connect,
      (callback, delay) => window.setTimeout(callback, delay),
      (timer) => window.clearTimeout(timer),
    );

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      reconnect.stop();
      window.clearTimeout(gapTimer.current);
      socket?.close();
      queuedEvents.current = [];
    };
  }, [identity, matchId, ownerKey, queryClient, queryKey, refetch]);

  return {
    snapshot: query.data,
    error: transportError ?? (query.error instanceof Error ? query.error : null),
    status,
    refetch,
  };
}
