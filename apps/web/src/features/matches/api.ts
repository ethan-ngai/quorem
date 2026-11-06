import { randomUUID } from "../../randomUUID";
/** @file api.ts @description Typed recoverable private match commands. @module matches */
import type { DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { recoverableCommand } from "./commandRecovery";

/** @returns The terminal match snapshot after an explicit concession. */
export function forfeitMatch(identity: DevelopmentIdentity, id: string) {
  return recoverableCommand(identity, `forfeit:${id}`, {}, async (_body, key) => {
    const { data, error } = await api(identity).POST("/v1/matches/{id}/forfeit", {
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
    params: { path: { id }, header: { "Idempotency-Key": randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}
