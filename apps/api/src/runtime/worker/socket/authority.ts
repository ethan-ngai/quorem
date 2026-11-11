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
import { interviewCommands } from "../../../modules/events/socket/interview.ts";
import { matchSocketSnapshot } from "../../../modules/events/socket/match.ts";
import type { Lifecycle } from "../../../modules/matches/lifecycle/model.ts";
import type { SocketAuthority, StoredSocket } from "./durable.ts";
import { socketTarget } from "./target.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const missing = () => new ApplicationError("not_found", "Realtime resource unavailable", 404);
/** Supply real verifier/session and 20b/19b domain owners from the Worker runtime. */
export function postgresSocketAuthority(deps: {
  run: Run;
  verifier: TokenVerifier;
  sessions: SessionAuthority;
  matches: Lifecycle;
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
    matchLeases = matchSocketLeases(run);
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
    const value = (await matches.read(actor, record.resourceId)) as { version?: unknown };
    if (typeof value?.version !== "string") throw missing();
    return value.version;
  }
  return {
    async issue(request) {
      const target = socketTarget(new URL(request.url).pathname);
      if (target?.mode !== "direct") throw missing();
      const mode = target.stream;
      const token = bearer(request.headers);
      let grant: VerifiedGrant, actor: Principal;
      if (token !== undefined) {
        const claims = await verifier.verify(token);
        actor = await authenticate(token, { verify: async () => claims }, sessions, bindings);
        grant = managedGrant(claims, actor.strongUntil);
      } else {
        const credential = guestCookie(request.headers, mode);
        if (!credential) throw new IdentityError("unauthorized");
        const hash = await guestTokenHash(credential);
        const guest = await readers.guest(mode, hash);
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
      };
      await authorize(record, actor);
      record.lease =
        mode === "interview"
          ? await presence.acquire(actor, target.id)
          : await matchLeases.acquire(actor, target.id);
      record.leaseOwner = actor.userId;
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
