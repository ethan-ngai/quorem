/** @file worker.ts @description Worker HTTP, socket and durable recovery composition. @module api */
// @ts-expect-error Workerd supplies this module.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { workerRuntime, type AuthWorkerEnv } from "@quorem/auth/worker";
import { IdentityError, type SessionAuthority } from "../modules/identity/model.ts";
import { jwtVerifier } from "../adapters/identity/jwt.ts";
import {
  cloudflareBinding,
  cloudflareRest,
  type QueueBinding,
} from "../adapters/delivery/cloudflare.ts";
import { cloudflareCoordinator } from "../adapters/scheduling/cloudflare.ts";
import { ShardAlarm, type AlarmStorage } from "../adapters/scheduling/coordinator.ts";
import {
  AdmissionRecovery,
  type AdmissionAlarmStorage,
} from "../modules/judging/admission/recovery.ts";
import { postgresDeadlines } from "../adapters/postgres/events/scheduling/deadlines.ts";
import { prearmReceipts } from "../adapters/postgres/events/scheduling/prearm.ts";
import { reconcileScheduledMatch } from "../adapters/postgres/matches/reconcile/repository.ts";
import { postgresDispatch, recoverExecutionIntents } from "../adapters/postgres/events/dispatch.ts";
import { dispatchBatch } from "../modules/events/dispatch/dispatch.ts";
import type { Notice, NoticeStream } from "../modules/events/dispatch/ports.ts";
import { browserSocketObject } from "./worker/socket/durable.ts";
import { postgresSocketAuthority } from "./worker/socket/authority.ts";
import { composeHttp } from "./composition/http.ts";
import { composeIdentity } from "./composition/identity.ts";
import { composePrivate } from "./composition/private.ts";
import { boundedInt, flag, keyBytes, privateConfig, required } from "./composition/config.ts";
import { requestBudget, unavailable } from "./composition/budget.ts";

interface SocketStub {
  fetch(request: Request): Promise<Response>;
  publish(notice: Notice): Promise<void>;
}
interface SocketNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): SocketStub;
}
interface CoordinatorStub {
  wake(shard: number): Promise<void>;
}
interface CoordinatorNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): CoordinatorStub;
}
export interface Env extends AuthWorkerEnv {
  SOCKETS: SocketNamespace;
  DEADLINES: CoordinatorNamespace;
  EXECUTION_RECOVERY: CoordinatorNamespace;
  EXECUTION_QUEUE: QueueBinding;
}
const origins = (env: Env) =>
  required(env.ALLOWED_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const runFor =
  (env: Env, signal?: AbortSignal) =>
  <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(
      env.DB.connectionString,
      { connectionTimeoutMs: 5000, lifetimeMs: 30000, signal },
      fn,
    );
function socketStub(env: Env, stream: NoticeStream) {
  return env.SOCKETS.get(env.SOCKETS.idFromName(`socket:${stream}`));
}
function notices(env: Env) {
  return {
    publish: (stream: NoticeStream, notice: Notice) => socketStub(env, stream).publish(notice),
  };
}
function wake(env: Env) {
  const provider = required(env.EXECUTION_WAKE_PROVIDER);
  if (provider === "cloudflare-binding") {
    if (!env.EXECUTION_QUEUE) throw new Error("Execution queue required");
    return cloudflareBinding(env.EXECUTION_QUEUE);
  }
  if (provider === "cloudflare-rest")
    return cloudflareRest({
      accountId: required(env.CLOUDFLARE_ACCOUNT_ID),
      queueId: required(env.CLOUDFLARE_QUEUE_ID),
      token: required(env.CLOUDFLARE_QUEUE_TOKEN),
    });
  throw new Error("Unsupported execution wake provider");
}
function makeSecurity(env: Env, signal?: AbortSignal) {
  const auth = workerRuntime(env, signal),
    origin = required(env.AUTH_ORIGIN);
  const verifier = jwtVerifier({
    issuer: origin,
    audience: "quorem-api",
    jwksURL: new URL("/api/auth/jwks", origin).href,
    fetch: async (input, init) => auth.app.fetch(new Request(input, init)),
  });
  const sessions: SessionAuthority = {
    async check(id, subject) {
      try {
        const result = await auth.repository.sessionAuthority(id, subject);
        if (!result.valid) throw new IdentityError("unauthorized");
        return { strongAt: result.strongAt };
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        throw new IdentityError("unavailable", error);
      }
    },
  };
  return { auth, verifier, sessions };
}
function makeHttp(env: Env, request: Request) {
  const run = runFor(env, request.signal),
    security = makeSecurity(env, request.signal),
    allowed = origins(env);
  const identity = composeIdentity(run, security.verifier, security.sessions, allowed);
  const result = composeHttp({
    run,
    ...identity,
    origins: allowed,
    trustedPeer: () => request.headers.get("cf-connecting-ip") ?? undefined,
    deadline: cloudflareCoordinator(env.DEADLINES),
    execution: cloudflareCoordinator(env.EXECUTION_RECOVERY),
    wake: wake(env),
    inviteKey: keyBytes(env.MATCH_INVITE_KEY),
    shards: boundedInt(env.DEADLINE_SHARDS, 1, 256),
    guestAdmission: flag(env.GUEST_ADMISSION),
    guestExecution: flag(env.GUEST_EXECUTION),
    localStrongBypass: false,
  });
  result.app.route("/", security.auth.app);
  return { ...result, run, security };
}
export const BrowserSockets = browserSocketObject<Env>((env) => {
  const run = runFor(env),
    security = makeSecurity(env),
    allowed = origins(env);
  const identity = composeIdentity(run, security.verifier, security.sessions, allowed);
  const composed = composeHttp({
    run,
    ...identity,
    origins: allowed,
    trustedPeer: () => undefined,
    deadline: cloudflareCoordinator(env.DEADLINES),
    execution: cloudflareCoordinator(env.EXECUTION_RECOVERY),
    wake: wake(env),
    inviteKey: keyBytes(env.MATCH_INVITE_KEY),
    shards: boundedInt(env.DEADLINE_SHARDS, 1, 256),
    guestAdmission: flag(env.GUEST_ADMISSION),
    guestExecution: flag(env.GUEST_EXECUTION),
    localStrongBypass: false,
  });
  return {
    origins: allowed,
    authority: postgresSocketAuthority({
      run,
      verifier: security.verifier,
      sessions: security.sessions,
      matches: composed.matches,
      submissions: composed.submissions,
      afterInterviewCommand: async () => {
        await dispatchBatch(postgresDispatch(run), notices(env), wake(env), "interview");
      },
    }),
  };
});
export class DeadlineCoordinator extends DurableObject {
  private actor: ShardAlarm;
  constructor(state: { storage: AlarmStorage }, env: Env) {
    super(state, env);
    const run = runFor(env);
    this.actor = new ShardAlarm(state.storage, {
      store: postgresDeadlines(run),
      receipts: prearmReceipts(run),
      shards: boundedInt(env.DEADLINE_SHARDS, 1, 256),
      reconcile: (candidate) =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
            reconcileScheduledMatch(tx, candidate.id, candidate.generation),
          ),
        ),
    });
  }
  wake(shard: number) {
    return this.actor.wake(shard);
  }
  alarm() {
    return this.actor.alarm();
  }
}
export class ExecutionRecovery extends DurableObject {
  private actor: AdmissionRecovery;
  constructor(state: { storage: AdmissionAlarmStorage }, env: Env) {
    super(state, env);
    const run = runFor(env);
    this.actor = new AdmissionRecovery(state.storage, prearmReceipts(run, "execution"), () =>
      dispatchBatch(postgresDispatch(run), notices(env), wake(env), "execution"),
    );
  }
  wake(shard: number) {
    return this.actor.wake(shard);
  }
  alarm() {
    return this.actor.alarm();
  }
}
function streamOf(path: string): NoticeStream | undefined {
  if (path === "/v1/memberships/events") return "membership";
  const match = /^\/v1\/(interviews|matches|match-invites|submissions)\/[^/]+\/events$/.exec(path);
  return match
    ? (
        {
          interviews: "interview",
          matches: "match",
          "match-invites": "match",
          submissions: "submission",
        } as const
      )[match[1] as "interviews" | "matches" | "match-invites" | "submissions"]
    : undefined;
}
let budget: ReturnType<typeof requestBudget> | undefined;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname,
        stream = streamOf(path);
      if (stream && request.headers.get("upgrade")?.toLowerCase() === "websocket")
        return await socketStub(env, stream).fetch(request);
      budget ??= requestBudget(boundedInt(env.HTTP_MAX_REQUESTS, 32, 1024));
      return await budget(request, async () => {
        const run = runFor(env, request.signal);
        if (path.startsWith("/internal/runner/") || path.startsWith("/internal/verification/")) {
          const handlers = await composePrivate(run, privateConfig(env));
          return path.startsWith("/internal/runner/")
            ? handlers.runner(request)
            : handlers.source(request);
        }
        const composed = makeHttp(env, request);
        const response = await composed.app.fetch(request);
        if (response.status < 400 && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
          const store = postgresDispatch(run),
            publisher = notices(env),
            queue = wake(env);
          for (const name of ["interview", "match", "submission", "membership"] as const) {
            try {
              await dispatchBatch(store, publisher, queue, name);
            } catch {
              /* Scheduled recovery retains the intent. */
            }
          }
        }
        return response;
      });
    } catch {
      return unavailable();
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const run = runFor(env),
      store = postgresDispatch(run),
      publisher = notices(env),
      queue = wake(env);
    await recoverExecutionIntents(run);
    for (const stream of ["interview", "match", "submission", "membership", "execution"] as const)
      await dispatchBatch(store, publisher, queue, stream);
    const deadlines = cloudflareCoordinator(env.DEADLINES),
      recovery = cloudflareCoordinator(env.EXECUTION_RECOVERY);
    for (let shard = 0; shard < boundedInt(env.DEADLINE_SHARDS, 1, 256); shard++)
      await deadlines.wake(shard);
    await recovery.wake(0);
  },
};
