/** @file actions.ts @description Voted destructive actions and rule-owned paid action delegation. @module factions */
import { sql } from "drizzle-orm";
import { parseLosslessJson, type JsonValue } from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import type { TeamAction, TeamVote } from "@quorem/contracts/factions";
import { fingerprint } from "../matches/lifecycle/crypto.ts";
import { projectAuthorizedVersion } from "../problems/queries/repository.ts";
import { projectQuestionRuntime } from "../problems/runtime.ts";
import { finishMatch, matchEvent } from "../matches/reconcile/repository.ts";
import type { TeamActionExecutor } from "./votes.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid team action", 400);
const changed = () =>
  new ApplicationError("document_changed", "The proposed document changed. Propose again.", 409);
/** Paid action ports share the rule owner's transaction, price checks and admission. */
export function teamActionExecutor(paid: TeamActionExecutor): TeamActionExecutor {
  const executor: TeamActionExecutor = {
    async quote(tx, actor, id, team, input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
      const value = input as Record<string, unknown>;
      if (value.kind === "submit" || value.kind === "reveal")
        return paid.quote(tx, actor, id, team, input);
      let action: TeamAction;
      if (value.kind === "concede") action = { kind: "concede" };
      else if (value.kind === "reset" || value.kind === "language") {
        if (value.documentEpoch !== team.epoch || value.documentVersion !== team.version)
          throw changed();
        if (value.kind === "language") {
          if (typeof value.language !== "string") throw invalid();
          const w = (
            await tx.execute<{ version: string }>(
              sql`SELECT problem_version_id::text AS version FROM workspaces WHERE id=${team.workspaceId}::uuid`,
            )
          ).rows[0];
          const raw = await projectAuthorizedVersion(tx, w.version);
          if (!raw) throw invalid();
          projectQuestionRuntime(
            parseLosslessJson(raw) as { [key: string]: JsonValue },
            value.language,
          );
          action = {
            kind: "language",
            language: value.language,
            documentEpoch: team.epoch,
            documentVersion: team.version,
          };
        } else action = { kind: "reset", documentEpoch: team.epoch, documentVersion: team.version };
      } else throw invalid();
      return {
        action,
        ruleVersion: await fingerprint(team.rules),
        cost: { seconds: 0, points: 0 },
      };
    },
    async execute(tx, actor, id, team, vote: TeamVote) {
      const action = vote.quote.action;
      if (action.kind === "submit" || action.kind === "reveal")
        return paid.execute(tx, actor, id, team, vote);
      const current = await executor.quote(tx, actor, id, team, action);
      if (
        current.ruleVersion !== vote.quote.ruleVersion ||
        current.cost.seconds !== vote.quote.cost.seconds ||
        current.cost.points !== vote.quote.cost.points
      )
        throw new ApplicationError("stale_quote", "Action terms changed. Propose again.", 409);
      if (action.kind === "concede") {
        await tx.execute(
          sql`UPDATE match_participants SET forfeited=true WHERE match_id=${id}::uuid AND team=${team.team}`,
        );
        await tx.execute(
          sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid AND owner_id IN (SELECT owner_id FROM match_participants WHERE match_id=${id}::uuid AND team=${team.team})`,
        );
        const remaining = (
          await tx.execute<{ team: number }>(
            sql`SELECT DISTINCT team FROM match_participants WHERE match_id=${id}::uuid AND NOT forfeited`,
          )
        ).rows;
        if (remaining.length === 1)
          await finishMatch(tx, id, "win", `team:${remaining[0].team}`, "forfeit");
        else if (!remaining.length)
          await finishMatch(tx, id, "cancelled", null, "forfeit_without_opponent");
        await matchEvent(tx, id, remaining.length <= 1 ? "match.completed" : "match.updated");
        return;
      }
      const workspace = (
        await tx.execute<{ version: string; language: string }>(
          sql`SELECT problem_version_id::text AS version,language FROM workspaces WHERE id=${team.workspaceId}::uuid`,
        )
      ).rows[0];
      const raw = await projectAuthorizedVersion(tx, workspace.version);
      if (!raw) throw invalid();
      const problem = parseLosslessJson(raw) as { [key: string]: JsonValue };
      const language = action.kind === "language" ? action.language : workspace.language;
      projectQuestionRuntime(problem, language);
      if (
        (
          await tx.execute(
            sql`SELECT 1 FROM submissions WHERE workspace_id=${team.workspaceId}::uuid AND state IN ('queued','running') LIMIT 1`,
          )
        ).rows.length
      )
        throw new ApplicationError("user_busy", "Wait for team execution to finish", 409);
      let workspaceId = team.workspaceId;
      if (language !== workspace.language) {
        const selected = (
          await tx.execute<{ id: string }>(
            sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id,team) SELECT ${crypto.randomUUID()}::uuid,owner_id,problem_version_id,${language},'match',match_id,team FROM workspaces WHERE id=${team.workspaceId}::uuid ON CONFLICT(match_id,owner_id,language) WHERE kind='match' DO UPDATE SET owner_id=excluded.owner_id RETURNING id::text`,
          )
        ).rows[0];
        workspaceId = selected.id;
        await tx.execute(
          sql`UPDATE match_participants SET workspace_id=${workspaceId}::uuid WHERE match_id=${id}::uuid AND team=${team.team}`,
        );
      }
      await tx.execute(
        sql`UPDATE match_teams SET workspace_id=${workspaceId}::uuid,source=${problem.starterSource as string},document_epoch=${crypto.randomUUID()}::uuid,document_version=0 WHERE match_id=${id}::uuid AND team=${team.team}`,
      );
      await tx.execute(
        sql`DELETE FROM team_document_updates WHERE match_id=${id}::uuid AND team=${team.team}`,
      );
      await tx.execute(
        sql`DELETE FROM team_document_presence WHERE match_id=${id}::uuid AND team=${team.team}`,
      );
      await matchEvent(tx, id, "match.updated");
    },
  };
  return executor;
}
