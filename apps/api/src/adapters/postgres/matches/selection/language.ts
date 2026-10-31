/** @file language.ts @description Transactional match workspace-language selection. @module matches */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { MatchLanguageSelection } from "../../../../modules/matches/selection/model.ts";
import { matchEvent } from "../reconcile/repository.ts";
import {
  lockMatch,
  lockMatchHost,
  requireMatchMember,
  matchCommandOwner,
} from "../lifecycle/repository.ts";
import { digest } from "../lifecycle/crypto.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export function matchLanguageSelection(run: Run, inviteKey: Uint8Array): MatchLanguageSelection {
  const command = matchCommandOwner(run, inviteKey);
  return {
    async switchLanguage(who, id, key, language) {
      if (typeof language !== "string")
        throw new ApplicationError(
          "invalid_input",
          "Language is unavailable for this problem",
          400,
        );
      const authorize = async (tx: Transaction) => {
        const host = await lockMatchHost(tx, id),
          m = await lockMatch(tx, id);
        if (m.host !== host) throw new ApplicationError("not_found", "Match not found", 404);
        await requireMatchMember(tx, who, id);
        return m;
      };
      return command(
        who,
        `matches/${id}/workspace-language`,
        key,
        null,
        async (tx) => {
          await authorize(tx);
          const state = (
            await tx.execute<{ active: boolean; version: string; forfeited: boolean }>(
              sql`SELECT m.state='active' AND m.deadline>clock_timestamp() AS active,m.problem_version_id::text AS version,p.forfeited FROM matches m JOIN match_participants p ON p.match_id=m.id AND p.owner_id=${who.userId} WHERE m.id=${id}::uuid`,
            )
          ).rows[0];
          if (!state?.active || state.forfeited)
            throw new ApplicationError(
              "invalid_transition",
              "Match language selection is closed",
              409,
            );
          if (
            !(
              await tx.execute(
                sql`SELECT 1 FROM problem_languages WHERE version_id=${state.version}::uuid AND language=${language}`,
              )
            ).rows.length
          )
            throw new ApplicationError(
              "invalid_input",
              "Language is unavailable for this problem",
              400,
            );
          if (
            (
              await tx.execute(
                sql`SELECT 1 FROM submissions WHERE owner_id=${who.userId} AND state IN ('queued','running') LIMIT 1`,
              )
            ).rows.length
          )
            throw new ApplicationError(
              "user_busy",
              "Wait for the current execution before switching languages",
              409,
            );
          const workspace = crypto.randomUUID();
          const row = (
            await tx.execute<{
              id: string;
              kind: string;
              problemVersionId: string;
              language: string;
              matchId: string;
            }>(
              sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES(${workspace}::uuid,${who.userId},${state.version}::uuid,${language},'match',${id}::uuid) ON CONFLICT(match_id,owner_id,language) WHERE kind='match' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id::text,kind,problem_version_id::text AS "problemVersionId",language,match_id::text AS "matchId"`,
            )
          ).rows[0];
          await tx.execute(
            sql`UPDATE match_participants SET workspace_id=${row.id}::uuid WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
          );
          await matchEvent(tx, id, "match.updated");
          return row;
        },
        undefined,
        async (tx) => {
          await authorize(tx);
        },
        await digest(language),
      );
    },
  };
}
