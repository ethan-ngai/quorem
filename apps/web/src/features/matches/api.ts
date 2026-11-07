import { ruleApproval } from "@quorem/contracts/match-rules";
import { authenticatedFetch } from "../auth/session";
import { RejectedMatchCommand } from "./errors";
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
  kind: "clipboard" | "copy" | "focus",
) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/rule-events", {
    body: { kind },
    params: { path: { id }, header: { "Idempotency-Key": randomUUID() } },
  });
  return requireData(data as MatchSnapshot | undefined, error);
}

export async function matchRuleAction(
  identity: DevelopmentIdentity,
  id: string,
  input: import("@quorem/contracts/match-rules").RuleActionRequest,
) {
  return recoverableCommand(
    identity,
    `rule-action:${id}`,
    { ...input, ...(input.approval ? { approval: ruleApproval(input.approval) } : {}) },
    async (body, key) => {
      const response = await authenticatedFetch(
        new URL(
          `/v1/matches/${id}/rule-actions`,
          import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (response.status >= 400 && response.status < 500)
          throw new RejectedMatchCommand(
            error?.error?.message ?? error?.message ?? "Action unavailable.",
          );
        throw new Error("Could not apply the match rule. Try again.");
      }
      return (await response.json()) as import("@quorem/contracts/match-rules").RuleActionResult;
    },
  );
}
