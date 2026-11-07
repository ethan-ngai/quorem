/** @file repository.ts @description Authorized idempotent team operations. @module factions */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import type { TeamSnapshot, TeamVote } from "@quorem/contracts/factions";
import type { Factions } from "../../../modules/factions/model.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import { resolveVote } from "../../../modules/factions/policy.ts";
import { ApplicationError } from "../../../application/error.ts";
import { lockMatchOwner } from "../matches/lifecycle/repository.ts";
import { fingerprint } from "../matches/lifecycle/crypto.ts";
import { validateGuest, lockParty } from "../parties/store.ts";
import { lockTeam, type TeamAccess } from "./access.ts";
import { teamLobby, organizeTeams } from "./lobby.ts";
import { pullTeamDocument, pushTeamDocument } from "./document.ts";
import { teamPeers, publishTeamPresence } from "./presence.ts";
import { teamVoteCommand, type TeamActionExecutor } from "./votes.ts";
import {
  activateDeadline,
  matchDeadlineShard,
  type Coordinator,
  type Receipts,
} from "../../../modules/events/scheduling/scheduling.ts";
import { consumePrearm } from "../events/scheduling/prearm.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export async function teamSnapshot(
  tx: Transaction,
  id: string,
  access: TeamAccess,
): Promise<TeamSnapshot> {
  const members = (
    await tx.execute<{ userId: string; name: string }>(
      sql`SELECT u.participant_id AS "userId",u.display_name AS name FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${id}::uuid AND p.team=${access.team} ORDER BY p.seat`,
    )
  ).rows;
  const votes = (
    await tx.execute<{ vote: TeamVote }>(
      sql`SELECT vote FROM team_votes WHERE match_id=${id}::uuid AND team=${access.team} ORDER BY created_at DESC LIMIT 8`,
    )
  ).rows.map((r) => resolveVote(r.vote, access.now));
  const latest = (
    await tx.execute<{ id: string }>(
      sql`SELECT s.id::text FROM submissions s JOIN match_participants p ON p.match_id=s.match_id AND p.owner_id=s.owner_id WHERE s.match_id=${id}::uuid AND p.team=${access.team} AND s.workspace_id=${access.workspaceId}::uuid ORDER BY s.admitted_at DESC,s.id DESC LIMIT 1`,
    )
  ).rows[0];
  return {
    team: access.team,
    workspaceId: access.workspaceId,
    language: access.language,
    serverNow: access.now,
    document: { source: access.source, version: access.version, epoch: access.epoch },
    members,
    votes,
    peers: await teamPeers(tx, id, access),
    ...(latest ? { latestSubmissionId: latest.id } : {}),
  };
}
export function factionRepository(
  run: Run,
  executor: TeamActionExecutor,
  wake: () => Promise<void> = async () => {},
  deadline?: { coordinator: Coordinator; receipts: Receipts; shards: number },
): Factions {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, fn));
  async function command(
    actor: Principal,
    id: string,
    key: string,
    route: string,
    body: Record<string, unknown>,
    authorize: (tx: Transaction) => Promise<unknown>,
    execute: (tx: Transaction) => Promise<unknown>,
  ) {
    const hash = await fingerprint(body);
    const vote = route === "factions:vote" || route === "factions:propose";
    const shard = deadline ? matchDeadlineShard(id, deadline.shards) : 0;
    const perform = (receipt?: string) =>
      transaction(async (tx) => {
        if (receipt) await consumePrearm(tx, receipt, shard);
        await lockMatchOwner(tx, actor);
        await validateGuest(tx, actor);
        await authorize(tx);
        const prior = (
          await tx.execute<{ hash: string; response: unknown }>(
            sql`SELECT body_hash AS hash,response FROM match_idempotency WHERE owner_id=${actor.userId} AND route=${route + ":" + id} AND key=${key} AND expires_at>clock_timestamp()`,
          )
        ).rows[0];
        if (prior) {
          if (prior.hash !== hash)
            throw new ApplicationError("idempotency_conflict", "Key used for another command", 409);
          return prior.response;
        }
        const value = await execute(tx);
        await tx.execute(
          sql`INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES(${actor.userId},${route + ":" + id},${key},${hash},${JSON.stringify(value)}::jsonb,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,route,key) DO UPDATE SET body_hash=excluded.body_hash,response=excluded.response,expires_at=excluded.expires_at`,
        );
        return value;
      });
    const result =
      vote && deadline
        ? await activateDeadline(deadline.receipts, deadline.coordinator, shard, perform)
        : await perform();
    try {
      if (vote) await wake();
    } catch {
      /* Durable execution intents recover a missed wake. */
    }
    return result;
  }
  return {
    lobby: (actor, id) =>
      transaction(async (tx) => {
        await lockMatchOwner(tx, actor);
        await validateGuest(tx, actor);
        await lockParty(tx, id, actor.userId);
        return teamLobby(tx, id);
      }),
    organize: (actor, id, key, body) =>
      command(
        actor,
        id,
        key,
        "factions:organize",
        body,
        (tx) => lockParty(tx, id, actor.userId),
        (tx) => organizeTeams(tx, actor, id, body),
      ),
    read: (actor, id) =>
      transaction(async (tx) => {
        await lockMatchOwner(tx, actor);
        return teamSnapshot(tx, id, await lockTeam(tx, actor, id));
      }),
    command: (actor, id, key, action, body) =>
      action === "pull" || action === "presence"
        ? transaction(async (tx) => {
            await lockMatchOwner(tx, actor);
            const team = await lockTeam(tx, actor, id, action === "presence");
            return action === "pull"
              ? pullTeamDocument(tx, id, team, body)
              : publishTeamPresence(tx, id, actor.userId, team, body);
          })
        : command(
            actor,
            id,
            key,
            "factions:" + action,
            body,
            (tx) => lockTeam(tx, actor, id),
            async (tx) => {
              const team = await lockTeam(tx, actor, id, action !== "pull");
              if (action === "push") return pushTeamDocument(tx, id, team, body);
              return teamVoteCommand(tx, actor, id, team, action, body, executor);
            },
          ),
  };
}
