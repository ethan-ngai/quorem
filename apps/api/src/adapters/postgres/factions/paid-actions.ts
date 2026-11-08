/** @file paid-actions.ts @description Paid team votes reuse match rules and transactional judge admission. @module factions */
import { sql } from "drizzle-orm";
import type { TeamAction } from "@quorem/contracts/factions";
import type { RuleActionRequest } from "@quorem/contracts/match-rules";
import { ApplicationError } from "../../../application/error.ts";
import { prepareRuleAction, executeRuleAction } from "../matches/rules/actions.ts";
import { requireSubmissionTime } from "../matches/rules/ledger.ts";
import {
  admitWorkspaceInTransaction,
  type AdmissionOptions,
} from "../judging/admission/repository.ts";
import { parseWorkspaceCommand } from "../../../modules/judging/admission/command.ts";
import type { TeamActionExecutor } from "./votes.ts";
export function paidTeamActions(config: AdmissionOptions): TeamActionExecutor {
  return {
    async quote(tx, actor, id, team, input) {
      const value = input as Record<string, unknown>;
      let action: TeamAction;
      let request: RuleActionRequest;
      if (value.kind === "submit") {
        const level = (
          await tx.execute<{ level: number }>(
            sql`SELECT COALESCE(o.level,CASE WHEN v.odyssey IS NULL THEN 0 ELSE 1 END) AS level FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN odyssey_progress o ON o.scope_id=w.id AND o.problem_version_id=w.problem_version_id WHERE w.id=${team.workspaceId}::uuid`,
          )
        ).rows[0].level;
        action = {
          kind: "submit",
          workspaceId: team.workspaceId,
          level,
          source: team.source,
          language: team.language,
          documentEpoch: team.epoch,
          documentVersion: team.version,
        };
        request = { kind: "submission" };
      } else if (
        value.kind === "reveal" &&
        ["topics", "complexity", "case"].includes(String(value.target))
      ) {
        if (
          value.target === "case" &&
          (typeof value.submissionId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(value.submissionId) ||
            (value.caseIndex !== undefined &&
              (!Number.isSafeInteger(value.caseIndex) || Number(value.caseIndex) < 0)))
        )
          throw new ApplicationError("invalid_input", "Invalid case proposal", 400);
        request = {
          kind: value.target === "case" ? "hiddenCase" : (value.target as "topics" | "complexity"),
          ...(value.target === "case"
            ? {
                submissionId: value.submissionId as string,
                caseIndex: value.caseIndex as number | undefined,
              }
            : {}),
        };
        action = {
          kind: "reveal",
          target: value.target as "topics" | "complexity" | "case",
          ...(request.submissionId ? { submissionId: request.submissionId } : {}),
        };
      } else throw new ApplicationError("invalid_input", "Invalid paid proposal", 400);
      const plan = await prepareRuleAction(tx, id, actor.userId, team.rules, request);
      if (plan.quote.seconds > 0)
        await requireSubmissionTime(tx, id, plan.subject, plan.quote.seconds);
      if (plan.quote.cooldownSeconds)
        throw new ApplicationError(
          "submission_cooldown",
          `Submit available in ${plan.quote.cooldownSeconds}s`,
          429,
        );
      if (
        action.kind === "reveal" &&
        "caseIndex" in plan.quote &&
        plan.quote.caseIndex !== undefined
      )
        action = { ...action, caseIndex: plan.quote.caseIndex };
      return {
        action,
        ruleVersion: plan.quote.ruleVersion,
        cost: { seconds: plan.quote.seconds, points: plan.quote.points },
      };
    },
    async execute(tx, actor, id, team, vote) {
      const action = vote.quote.action;
      const approval = { ruleVersion: vote.quote.ruleVersion, ...vote.quote.cost };
      if (action.kind === "submit") {
        if (
          action.workspaceId !== team.workspaceId ||
          action.documentEpoch !== team.epoch ||
          action.language !== team.language
        )
          throw new ApplicationError("document_changed", "The proposed document was replaced", 409);
        const command = await parseWorkspaceCommand(
          JSON.stringify({
            workspaceId: action.workspaceId,
            kind: "submit",
            source: action.source,
            level: action.level,
            matchApproval: approval,
          }),
          vote.id,
        );
        // Admission atomically persists the dispatch intent; scheduled repair owns lost post-commit wakes.
        await admitWorkspaceInTransaction(
          tx,
          config,
          actor,
          vote.id,
          command,
          { receiptId: null, jobId: crypto.randomUUID(), shard: 0 },
          vote.id,
        );
      } else if (action.kind === "reveal") {
        const request: RuleActionRequest = {
          kind: action.target === "case" ? "hiddenCase" : action.target,
          submissionId: action.submissionId,
          caseIndex: action.caseIndex,
          approval,
        };
        await executeRuleAction(tx, id, actor.userId, team.rules, request, vote.id);
      } else throw new ApplicationError("invalid_input", "Invalid paid action", 400);
    },
  };
}
