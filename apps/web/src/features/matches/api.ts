/** @file api.ts @description Typed recoverable private match commands. @module matches */
import type {
  CreateMatchRequest,
  DevelopmentIdentity,
  MatchInvite,
  MatchSnapshot,
} from "@quorem/contracts";
import { api, requireData } from "../editor/api";
import { recoverableCommand, rememberInvite } from "./commandRecovery";

/** @returns A private lobby; uncertain create responses replay the original payload and key. */
export function createMatch(identity: DevelopmentIdentity, body: CreateMatchRequest) {
  return recoverableCommand(
    identity,
    "create",
    body,
    async (payload, key) => {
      const { data, error } = await api(identity).POST("/v1/matches", {
        body: payload,
        params: { header: { "Idempotency-Key": key } },
      });
      const invite = requireData(data as MatchInvite | undefined, error);
      rememberInvite(identity, invite);
      return invite;
    },
    true,
  );
}

/** @returns An authoritative snapshot after accepting a private token. */
export function joinMatch(identity: DevelopmentIdentity, inviteToken: string) {
  return recoverableCommand(identity, `join:${inviteToken}`, { inviteToken }, async (body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/join", {
      body,
      params: { header: { "Idempotency-Key": key } },
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

/** @returns Updated readiness; callers refetch rather than applying possibly cached command snapshots. */
export function setReady(identity: DevelopmentIdentity, id: string, ready: boolean) {
  return recoverableCommand(identity, `ready:${id}`, { ready }, async (body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/{id}/ready", {
      params: { path: { id }, header: { "Idempotency-Key": key } },
      body,
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

/** @returns Settings accepted by the host's pre-start lobby. */
export function updateMatchSettings(
  identity: DevelopmentIdentity,
  id: string,
  settings: CreateMatchRequest,
) {
  return recoverableCommand(identity, `settings:${id}`, settings, async (body, key) => {
    const { data, error } = await api(identity).PUT("/v1/matches/{id}/settings", {
      params: { path: { id }, header: { "Idempotency-Key": key } },
      body,
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

/** @returns The terminal match snapshot after an explicit concession. */
export function forfeitMatch(identity: DevelopmentIdentity, id: string) {
  return recoverableCommand(identity, `forfeit:${id}`, {}, async (_body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/{id}/forfeit", {
      params: { path: { id }, header: { "Idempotency-Key": key } },
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

/** @returns The pre-start lobby snapshot after leaving. */
export function leaveMatch(identity: DevelopmentIdentity, id: string) {
  return recoverableCommand(identity, `leave:${id}`, {}, async (_body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/{id}/leave", {
      params: { path: { id }, header: { "Idempotency-Key": key } },
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

export function startMatch(identity: DevelopmentIdentity, id: string) {
  return recoverableCommand(identity, `start:${id}`, {}, async (_body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/{id}/start", {
      params: { path: { id }, header: { "Idempotency-Key": key } },
    });
    return requireData(data as MatchSnapshot | undefined, error);
  });
}

/** Reports the event kind only; clipboard data and navigation targets remain private. */
export async function reportRuleEvent(
  identity: DevelopmentIdentity,
  id: string,
  kind: "clipboard" | "focus",
) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/rule-events", {
    body: { kind },
    params: { path: { id }, header: { "Idempotency-Key": crypto.randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}
