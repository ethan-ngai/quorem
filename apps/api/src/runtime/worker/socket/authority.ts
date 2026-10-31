/** @file authority.ts @description Production socket grants composed from canonical identity and domain owners. @module runtime */
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import {
  authenticate,
  IdentityError,
  type IdentityBindings,
  type Principal,
  type SessionAuthority,
  type TokenVerifier,
} from "../../../modules/identity/model.ts";
import { bearer } from "../../../modules/identity/credentials.ts";
import { guestCookie, guestTokenHash } from "../../../modules/identity/guest/credentials.ts";
import {
  managedGrant,
  reauthorizeGrant,
  type GrantReaders,
  type VerifiedGrant,
} from "../../../modules/identity/grant.ts";
import {
  identityRepository,
  verifiedIdentityReader,
  participantKey,
} from "../../../adapters/postgres/identity/repository.ts";
import { guestRepository } from "../../../adapters/postgres/identity/guest.ts";
import {
  verifiedInviteGrant,
  verifiedInviteReader,
} from "../../../adapters/postgres/matches/invitations/repository.ts";
import { readInterviewAccess } from "../../../adapters/postgres/interviews/lifecycle/access.ts";
import { capabilitiesInTransaction } from "../../../adapters/postgres/access/repository.ts";
import {
  interviewPresence,
  releaseInterviewLease,
} from "../../../adapters/postgres/interviews/presence/repository.ts";
import { interviewDocumentCommands } from "../../../adapters/postgres/interviews/document/commands.ts";
import { interviewMonitoring } from "../../../adapters/postgres/interviews/monitoring/repository.ts";
import { matchSocketLeases } from "../../../adapters/postgres/matches/socket/leases.ts";
import { interviewCommands } from "../../../modules/events/socket/interview.ts";
import { matchSocketSnapshot } from "../../../modules/events/socket/match.ts";
import type { Lifecycle } from "../../../modules/matches/lifecycle/model.ts";
import type { SubmissionSnapshots } from "../../../modules/judging/results/model.ts";
import type { SocketAuthority, StoredSocket } from "./durable.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Mode = StoredSocket["mode"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Realtime resource unavailable", 404);
function route(request: Request): { mode: Mode; id: string } {
  const path = new URL(request.url).pathname;
  if (path === "/v1/memberships/events") return { mode: "membership", id: "" };
  const match = /^\/v1\/(interviews|matches|submissions|match-invites)\/([^/]+)\/events$/.exec(
    path,
  );
  if (!match) throw missing();
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    throw missing();
  }
  const mode = (
    {
      interviews: "interview",
      matches: "match",
      submissions: "submission",
      "match-invites": "invite",
    } as const
  )[match[1] as "interviews" | "matches" | "submissions" | "match-invites"];
  if (mode !== "invite" && !uuid.test(id)) throw missing();
  return { mode, id };
}
/** Supply real verifier/session and 20b/19b domain owners from the Worker runtime. */
export function postgresSocketAuthority(deps: {
  run: Run;
  verifier: TokenVerifier;
  sessions: SessionAuthority;
  matches: Lifecycle;
  submissions: SubmissionSnapshots;
}): SocketAuthority {
  const { run, verifier, sessions, matches, submissions } = deps;
  const bindings: IdentityBindings = {
    lookup: (claims) => run((scope) => identityRepository(scope).lookup(claims)),
    resolve: (claims) => run((scope) => identityRepository(scope).resolve(claims)),
  };
  const readers: GrantReaders = {
    sessions,
    managed: (grant) => run((scope) => verifiedIdentityReader(scope)(grant)),
    guest: (kind, hash) => run((scope) => guestRepository(scope).lookup(kind, hash)),
    invite: verifiedInviteReader(run),
  };
  const presence = interviewPresence(run),
    matchLeases = matchSocketLeases(run);
  async function authorize(record: StoredSocket, actor: Principal | undefined): Promise<string> {
    if (record.mode === "invite") {
      await reauthorizeGrant(record.grant, readers);
      return "invite";
    }
    if (!actor) throw new IdentityError("unauthorized");
    if (record.mode === "membership") return actor.userId;
    if (record.mode === "interview") {
      const access = await run((scope) =>
        scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
          readInterviewAccess(tx, actor, record.resourceId, capabilitiesInTransaction, {
            active: true,
          }),
        ),
      );
      return `${access.role}:${access.questionEpoch}:${access.state}`;
    }
    if (record.mode === "match") {
      const value = (await matches.read(actor, record.resourceId)) as { version?: unknown };
      if (typeof value?.version !== "string") throw missing();
      return value.version;
    }
    const stream = await submissions.read(actor, record.resourceId);
    await stream.cancel();
    return actor.userId;
  }
  return {
    async issue(request) {
      const target = route(request);
      if (target.mode === "invite") {
        const grant = await verifiedInviteGrant(run, target.id);
        return { mode: "invite", resourceId: grant.resourceId, grant };
      }
      const token = bearer(request.headers);
      let grant: VerifiedGrant, actor: Principal;
      if (token !== undefined) {
        const claims = await verifier.verify(token);
        actor = await authenticate(token, { verify: async () => claims }, sessions, bindings);
        grant = managedGrant(claims, actor.strongUntil);
      } else {
        const kinds =
          target.mode === "match"
            ? (["match"] as const)
            : target.mode === "interview"
              ? (["interview"] as const)
              : (["match", "interview"] as const);
        const candidates = kinds
          .map((kind) => ({ kind, token: guestCookie(request.headers, kind) }))
          .filter((v) => v.token !== undefined);
        if (candidates.length !== 1) throw new IdentityError("unauthorized");
        const candidate = candidates[0],
          hash = await guestTokenHash(candidate.token!);
        const guest = await readers.guest(candidate.kind, hash);
        if (!guest) throw new IdentityError("unauthorized");
        const resourceId =
          guest.scope.kind === "match" ? guest.scope.matchId : guest.scope.interviewId;
        actor = guest;
        grant = {
          kind: "guest",
          scope: candidate.kind,
          resourceId,
          hash,
          expiresAt: guest.credentialExpiresAt,
        };
      }
      const record: StoredSocket = {
        mode: target.mode,
        resourceId:
          target.mode === "membership"
            ? await run((scope) => participantKey(scope, actor.userId))
            : target.id,
        grant,
      };
      await authorize(record, actor);
      if (target.mode === "interview" || target.mode === "match") {
        record.lease =
          target.mode === "interview"
            ? await presence.acquire(actor, target.id)
            : await matchLeases.acquire(actor, target.id);
        record.leaseOwner = actor.userId;
      }
      return record;
    },
    async open(record, binding) {
      return {
        security: {
          verify: async (signal) => ({
            principal: await reauthorizeGrant(record.grant, readers, Date.now(), signal),
            binding,
            expiresAt: record.grant.expiresAt * 1000,
          }),
          authorize: (actor) => authorize(record, actor),
        },
        ...(record.mode === "interview"
          ? {
              commands: interviewCommands(record.resourceId, {
                documents: interviewDocumentCommands(run),
                presence,
                monitoring: interviewMonitoring(run),
              }),
            }
          : {}),
        ...(record.mode === "match"
          ? { snapshot: matchSocketSnapshot(record.resourceId, matches) }
          : {}),
        ...(record.lease && (record.mode === "interview" || record.mode === "match")
          ? {
              renew: (actor: Principal) =>
                record.mode === "interview"
                  ? presence.renew(actor, record.resourceId, record.lease!)
                  : matchLeases.renew(actor, record.resourceId, record.lease!),
            }
          : {}),
      };
    },
    async release(record) {
      if (!record.lease || !record.leaseOwner) return;
      if (record.mode === "interview")
        await releaseInterviewLease(run, record.resourceId, record.leaseOwner, record.lease);
      if (record.mode === "match")
        await matchLeases.release(record.leaseOwner, record.resourceId, record.lease);
    },
  };
}
