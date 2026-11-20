/** @file authority.ts @description Production socket grants composed from canonical identity and domain owners. @module runtime */
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import {
  authenticate,
  guestScopeId,
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
  type ManagedGrant,
  type VerifiedGrant,
} from "../../../modules/identity/grant.ts";
import {
  identityRepository,
  verifiedIdentityReader,
} from "../../../adapters/postgres/identity/repository.ts";
import { guestRepository } from "../../../adapters/postgres/identity/guest.ts";
import { readInterviewAccess } from "../../../adapters/postgres/interviews/lifecycle/access.ts";
import { capabilitiesInTransaction } from "../../../adapters/postgres/access/repository.ts";
import {
  interviewPresence,
  releaseInterviewLease,
} from "../../../adapters/postgres/interviews/presence/repository.ts";
import { interviewDocumentCommands } from "../../../adapters/postgres/interviews/document/commands.ts";
import { interviewMonitoring } from "../../../adapters/postgres/interviews/monitoring/repository.ts";
import { matchSocketLeases } from "../../../adapters/postgres/matches/socket/leases.ts";
import { partySocketLeases } from "../../../adapters/postgres/parties/socket-leases.ts";
import type { Parties } from "../../../modules/parties/model.ts";
import { interviewCommands } from "../../../modules/events/socket/interview.ts";
import { matchSocketSnapshot } from "../../../modules/events/socket/match.ts";
import type { Lifecycle } from "../../../modules/matches/lifecycle/model.ts";
import type { SocketAuthority, StoredSocket } from "./durable.ts";
import { socketTarget } from "./target.ts";
import { supportsHibernation } from "./handshake.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const missing = () => new ApplicationError("not_found", "Realtime resource unavailable", 404);
/** Supply real verifier/session and 20b/19b domain owners from the Worker runtime. */
export function postgresSocketAuthority(deps: {
  run: Run;
  verifier: TokenVerifier;
  sessions: SessionAuthority;
  matches: Lifecycle;
  parties?: Parties;
  afterPartyPresence?: (party: string) => Promise<void>;
  socketSession?: (request: Request) => Promise<ManagedGrant | undefined>;
  beforeInterviewCommand?: () => Promise<void>;
  afterInterviewCommand?: () => Promise<void>;
}): SocketAuthority {
  const { run, verifier, sessions, matches } = deps;
  const bindings: IdentityBindings = {
    lookup: (claims) => run((scope) => identityRepository(scope).lookup(claims)),
    resolve: (claims) => run((scope) => identityRepository(scope).resolve(claims)),
  };
  const readers: GrantReaders = {
    sessions,
    managed: (grant) => run((scope) => verifiedIdentityReader(scope)(grant)),
    guest: (kind, hash) => run((scope) => guestRepository(scope).lookup(kind, hash)),
  };
  const presence = interviewPresence(run),
    matchLeases = matchSocketLeases(run),
    partyLeases = partySocketLeases(run);
  const readParty = async (actor: Principal, id: string) => {
    const value = (await deps.parties?.read(actor, id)) as { version?: unknown } | undefined;
    if (typeof value?.version !== "string") throw missing();
    return { value, version: value.version };
  };
  async function authorize(record: StoredSocket, actor: Principal | undefined): Promise<string> {
    if (!actor) throw new IdentityError("unauthorized");
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
    if (record.mode === "party") return (await readParty(actor, record.resourceId)).version;
    const value = (await matches.read(actor, record.resourceId)) as { version?: unknown };
    if (typeof value?.version !== "string") throw missing();
    return value.version;
  }
  return {
    async issue(request) {
      const target = socketTarget(new URL(request.url).pathname);
      if (target?.mode !== "direct") throw missing();
      const mode = target.stream;
      const hibernating = !!deps.socketSession && supportsHibernation(request);
      const token = bearer(request.headers);
      const cookieGrant = hibernating ? await deps.socketSession?.(request) : undefined;
      let grant: VerifiedGrant, actor: Principal;
      if (cookieGrant) {
        if (token !== undefined) {
          const claims = await verifier.verify(token);
          if (
            claims.issuer !== cookieGrant.issuer ||
            claims.subject !== cookieGrant.subject ||
            claims.sessionId !== cookieGrant.sessionId
          )
            throw new IdentityError("unauthorized");
        }
        grant = cookieGrant;
        actor = await reauthorizeGrant(grant, readers);
      } else if (token !== undefined) {
        const claims = await verifier.verify(token);
        actor = await authenticate(token, { verify: async () => claims }, sessions, bindings);
        grant = managedGrant(claims, actor.strongUntil);
      } else {
        const kind = mode === "interview" ? "interview" : "match";
        const credential = guestCookie(request.headers, kind);
        if (!credential) throw new IdentityError("unauthorized");
        const hash = await guestTokenHash(credential);
        const guest = await readers.guest(kind, hash);
        if (!guest) throw new IdentityError("unauthorized");
        const resourceId = guestScopeId(guest.scope);
        actor = guest;
        grant = {
          kind: "guest",
          scope: guest.scope.kind,
          resourceId,
          hash,
          expiresAt: guest.credentialExpiresAt,
        };
      }
      const record: StoredSocket = {
        mode,
        resourceId: target.id,
        grant,
        hibernating,
      };
      if (hibernating)
        record.grant.expiresAt = Math.min(grant.expiresAt, Math.floor(Date.now() / 1000) + 30 * 60);
      await authorize(record, actor);
      const expiresAt = record.hibernating ? grant.expiresAt : undefined;
      record.lease =
        mode === "interview"
          ? await presence.acquire(actor, target.id, expiresAt)
          : mode === "party"
            ? await partyLeases.acquire(actor, target.id, expiresAt)
            : await matchLeases.acquire(actor, target.id, expiresAt);
      record.leaseOwner = actor.userId;
      if (mode === "party") await deps.afterPartyPresence?.(target.id);
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
              commands: (() => {
                const commands = interviewCommands(record.resourceId, {
                  documents: interviewDocumentCommands(run),
                  presence,
                  monitoring: interviewMonitoring(run),
                });
                return {
                  async execute(
                    actor: Principal,
                    command: Parameters<typeof commands.execute>[1],
                    signal: AbortSignal,
                  ) {
                    const changes = ["push", "presence", "rule-event"].includes(command.type);
                    if (changes) await deps.beforeInterviewCommand?.();
                    const result = await commands.execute(actor, command, signal);
                    if (changes && deps.afterInterviewCommand) {
                      try {
                        await deps.afterInterviewCommand();
                      } catch {
                        /* Durable outbox repair remains armed. */
                      }
                    }
                    return result;
                  },
                };
              })(),
            }
          : {}),
        ...(record.mode === "match"
          ? { snapshot: matchSocketSnapshot(record.resourceId, matches) }
          : {}),
        ...(record.mode === "party"
          ? {
              snapshot: {
                async read(actor: Principal | undefined) {
                  if (!actor) throw new IdentityError("unauthorized");
                  const { value, version } = await readParty(actor, record.resourceId);
                  return {
                    body: JSON.stringify({ type: "party.snapshot", party: value }),
                    version,
                  };
                },
              },
            }
          : {}),
        ...(record.lease && !record.hibernating
          ? {
              renew: (actor: Principal) =>
                record.mode === "interview"
                  ? presence.renew(actor, record.resourceId, record.lease!)
                  : record.mode === "party"
                    ? partyLeases.renew(actor, record.resourceId, record.lease!)
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
      if (record.mode === "party") {
        await partyLeases.release(record.leaseOwner, record.resourceId, record.lease);
        await deps.afterPartyPresence?.(record.resourceId);
      }
    },
  };
}
