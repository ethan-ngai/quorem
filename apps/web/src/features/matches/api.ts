/** @file api.ts @description Typed private match commands. @module matches */
import type {
  CreateMatchRequest,
  DevelopmentIdentity,
  MatchInvite,
  MatchSnapshot,
} from "@quorem/contracts";
import { api, requireData } from "../editor/api";

/** @returns A newly created lobby and its private invitation. */
export async function createMatch(identity: DevelopmentIdentity, body: CreateMatchRequest) {
  const { data, error } = await api(identity).POST("/v1/matches", {
    body,
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
  });
  return requireData(data as MatchInvite | undefined, error);
}

/** @returns An authoritative snapshot after joining with a private token. */
export async function joinMatch(identity: DevelopmentIdentity, inviteToken: string) {
  const { data, error } = await api(identity).POST("/v1/matches/join", {
    body: { inviteToken },
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}

/** @returns Updated readiness; the server owns the start transition. */
export async function setReady(identity: DevelopmentIdentity, id: string, ready: boolean) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/ready", {
    params: { path: { id }, header: { "Idempotency-Key": crypto.randomUUID() } },
    body: { ready },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}

/** @returns Settings accepted by the host's pre-start lobby. */
export async function updateMatchSettings(
  identity: DevelopmentIdentity,
  id: string,
  body: CreateMatchRequest,
) {
  const { data, error } = await api(identity).PUT("/v1/matches/{id}/settings", {
    params: { path: { id }, header: { "Idempotency-Key": crypto.randomUUID() } },
    body,
  });
  return requireData(data as MatchSnapshot | undefined, error);
}

/** @returns The terminal match snapshot after an explicit concession. */
export async function forfeitMatch(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/forfeit", {
    params: { path: { id }, header: { "Idempotency-Key": crypto.randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}

/** @returns The pre-start lobby snapshot after leaving. */
export async function leaveMatch(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/leave", {
    params: { path: { id }, header: { "Idempotency-Key": crypto.randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}
