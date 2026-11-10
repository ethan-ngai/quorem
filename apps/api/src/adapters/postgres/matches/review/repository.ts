/** @file repository.ts @description Authorized latest-round review projection. @module matches */
import { lockMatch, lockMatchOwner, requireMatchMember } from "../lifecycle/repository.ts";
import { matchSubmissionDeadline } from "../rules/ledger.ts";
import { authorizeReview } from "./authorization.ts";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { MatchReview } from "../../../../modules/matches/review/model.ts";
import type { WorkspaceLanguage } from "../../../../modules/workspace/model.ts";
import { questionRuntime } from "../../problems/runtime.ts";
import { projectAuthorizedPublication } from "../../problems/queries/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Participant = {
  userId: string;
  displayName: string;
  image: string | null;
  color: number;
  own: boolean;
  workspace: { id: string; language: WorkspaceLanguage } | null;
  starterLanguage: WorkspaceLanguage | null;
  finalCode: { language: WorkspaceLanguage; source: string } | null;
  submission: {
    language: WorkspaceLanguage;
    source: string;
    verdict: string | null;
    state: string;
    winning: boolean;
  } | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Match review not found", 404);

/** Reads source only after authorizing the entire settled round and viewer's latest participation. */
export function matchReviewRepository(run: Run): MatchReview {
  return {
    async createWorkspace(principal, matchId, participantUserId, language) {
      if (!uuid.test(matchId) || !uuid.test(participantUserId)) throw missing();
      return run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          await authorizeReview(tx, principal, matchId);
          const source = (
            await tx.execute<{ owner: string }>(
              sql`SELECT p.owner_id AS owner FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${matchId}::uuid AND u.participant_id=${participantUserId}::uuid`,
            )
          ).rows[0];
          if (!source) throw missing();
          const match = await authorizeReview(tx, principal, matchId, source.owner);
          const version = (
            await tx.execute<{ isSql: boolean }>(
              sql`SELECT sql_config IS NOT NULL AND sql_config <> 'null'::jsonb AS "isSql" FROM question_publications WHERE id=${match.problemId}::uuid`,
            )
          ).rows[0];
          if (!version) throw missing();
          questionRuntime(language, version.isSql);
          return (
            await tx.execute<{
              id: string;
              kind: "review";
              problemVersionId: string;
              language: WorkspaceLanguage;
              reviewMatchId: string;
            }>(sql`
          INSERT INTO workspaces(id,owner_id,publication_id,language,kind,review_match_id,review_source_owner_id)
          VALUES(${crypto.randomUUID()}::uuid,${principal.userId},${match.problemId}::uuid,${language},'review',${matchId}::uuid,${source.owner})
          ON CONFLICT(review_match_id,owner_id,review_source_owner_id,language) WHERE kind='review' DO UPDATE SET owner_id=EXCLUDED.owner_id
          RETURNING id::text,kind,publication_id::text AS "problemVersionId",language,review_match_id::text AS "reviewMatchId"
        `)
          ).rows[0];
        }),
      );
    },
    async saveFinalCode(principal, matchId, workspaceId, source) {
      if (!uuid.test(matchId) || !uuid.test(workspaceId)) throw missing();
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          await lockMatchOwner(tx, principal);
          const match = await lockMatch(tx, matchId);
          await requireMatchMember(tx, principal, matchId);
          if (match.state !== "active" || match.mode === "factions")
            throw new ApplicationError("invalid_transition", "Match editing has closed", 409);
          const saved = await tx.execute(sql`
            UPDATE workspaces w SET match_review_source=${source}
            FROM matches m JOIN match_participants p ON p.match_id=m.id
            WHERE m.id=${matchId}::uuid AND m.review_final_code AND m.share_code_after_match
              AND ${matchSubmissionDeadline(sql`m`)}>clock_timestamp()
              AND p.owner_id=${principal.userId} AND NOT p.forfeited
              AND w.id=p.workspace_id AND w.id=${workspaceId}::uuid AND w.owner_id=p.owner_id
              AND w.match_id=m.id AND w.kind='match'
          `);
          if (!saved.rowCount)
            throw new ApplicationError("invalid_transition", "Match editing has closed", 409);
        }),
      );
    },
    async read(principal, matchId) {
      if (!uuid.test(matchId)) throw missing();
      return run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          const match = await authorizeReview(tx, principal, matchId);
          const teammate = sql`(p.team IS NOT NULL AND p.team=(SELECT team FROM match_participants viewer WHERE viewer.match_id=p.match_id AND viewer.owner_id=${principal.userId}))`;
          const participants = (
            await tx.execute<Participant>(sql`
          SELECT u.participant_id AS "userId",u.display_name AS "displayName",NULLIF(u.profile_image,'') AS image,u.profile_color AS color,p.owner_id=${principal.userId} AS own,
            CASE WHEN p.owner_id=${principal.userId} AND active.id IS NOT NULL THEN jsonb_build_object('id',active.id,'language',active.language) ELSE NULL END AS workspace,
            CASE WHEN final.source IS NOT NULL AND (m.review_winning_submission_id IS NULL OR s.id IS DISTINCT FROM m.review_winning_submission_id)
              THEN jsonb_build_object('language',active.language,'source',final.source) END AS "finalCode",
            CASE WHEN m.review_final_code AND m.share_code_after_match AND final.source IS NULL AND s.id IS NULL
              THEN active.language END AS "starterLanguage",
            CASE WHEN s.id IS NOT NULL AND (final.source IS NULL OR s.id=m.review_winning_submission_id) THEN jsonb_build_object('language',sw.language,'source',s.source,'verdict',s.result->>'verdict','state',s.state,'winning',COALESCE(s.id=m.review_winning_submission_id,false)) ELSE NULL END AS submission
          FROM match_participants p JOIN users u ON u.id=p.owner_id
          JOIN matches m ON m.id=p.match_id
          LEFT JOIN match_teams t ON t.match_id=p.match_id AND t.team=p.team
          LEFT JOIN workspaces active ON active.id=COALESCE(t.workspace_id,p.workspace_id)
          LEFT JOIN LATERAL (
            SELECT CASE WHEN m.review_final_code THEN COALESCE(t.source,active.match_review_source) END AS source
          ) final ON true
          LEFT JOIN LATERAL (SELECT id,workspace_id,source,result,state FROM submissions
            WHERE match_id=p.match_id
              AND (NOT m.review_final_code OR NOT m.share_code_after_match OR workspace_id=active.id OR id=m.review_winning_submission_id)
              AND (owner_id=p.owner_id OR (p.team IS NOT NULL AND owner_id IN (SELECT owner_id FROM match_participants contributor WHERE contributor.match_id=p.match_id AND contributor.team=p.team))) AND kind='submit' AND match_sequence IS NOT NULL
              AND (p.owner_id=${principal.userId} OR ${teammate} OR ${match.shareCodeAfterMatch})
            ORDER BY (id=m.review_winning_submission_id) DESC NULLS LAST,match_sequence DESC LIMIT 1) s ON true
          LEFT JOIN workspaces sw ON sw.id=s.workspace_id
          WHERE p.match_id=${matchId}::uuid AND (p.owner_id=${principal.userId} OR ${teammate} OR ${match.shareCodeAfterMatch}) ORDER BY p.seat
        `)
          ).rows;
          const problem = await projectAuthorizedPublication(tx, match.problemId);
          if (!problem) throw missing();
          const starters = participants.some((person) => person.starterLanguage)
            ? new Map(
                (
                  JSON.parse(problem) as {
                    languages: { language: string; starterSource: string }[];
                  }
                ).languages.map((language) => [language.language, language.starterSource]),
              )
            : undefined;
          const prefix = JSON.stringify({
            matchId,
            completedAt: match.completedAt,
            shareCodeAfterMatch: match.shareCodeAfterMatch,
            outcome: match.outcome,
            participants: participants.map(({ image, color, starterLanguage, ...person }) => {
              const starter = starterLanguage && starters?.get(starterLanguage);
              return {
                ...person,
                finalCode:
                  starterLanguage && typeof starter === "string"
                    ? { language: starterLanguage, source: starter }
                    : person.finalCode,
                image: image ?? undefined,
                color: color || undefined,
              };
            }),
          });
          return `${prefix.slice(0, -1)},"problem":${problem}}`;
        }),
      );
    },
  };
}
