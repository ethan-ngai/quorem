/** @file worker.ts @description Worker HTTP, socket and durable recovery composition. @module api */
import { judgingCapacity } from "@quorem/execution";
// @ts-expect-error Workerd supplies this module.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { workerRuntime, type AuthWorkerEnv } from "@quorem/auth/worker";
import { authPeerRequest, cloudflarePeer } from "@quorem/auth/peer";
import {
  IdentityError,
  type SessionAuthority,
  type TokenVerifier,
} from "../modules/identity/model.ts";
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
import { retainBatch } from "../adapters/postgres/events/scheduling/retention.ts";
import { postgresDeadlines } from "../adapters/postgres/events/scheduling/deadlines.ts";
import { prearmReceipts } from "../adapters/postgres/events/scheduling/prearm.ts";
import { reconcileScheduledMatch } from "../adapters/postgres/matches/reconcile/repository.ts";
import { postgresDispatch, recoverExecutionIntents } from "../adapters/postgres/events/dispatch.ts";
import { dispatchBatch } from "../modules/events/dispatch/dispatch.ts";
import type { Notice, NoticeStream } from "../modules/events/dispatch/ports.ts";
import { socketHandshake } from "./worker/socket/handshake.ts";
import { socketTarget, type SocketTarget } from "./worker/socket/target.ts";
import { browserSocketObject } from "./worker/socket/durable.ts";
import { postgresSocketAuthority } from "./worker/socket/authority.ts";
import { composeHttp } from "./composition/http.ts";
import { composeIdentity } from "./composition/identity.ts";
import { localJudgingDrain } from "./composition/judging-drain.ts";
import { judgingProfile } from "./composition/judging-profile.ts";
import { composePrivate } from "./composition/private.ts";
import {
  boundedInt,
  drainConfig,
  flag,
  keyBytes,
  privateConfig,
  required,
} from "./composition/config.ts";
import { requestBudget, unavailable } from "./composition/budget.ts";
import { privateResponse } from "./composition/private-response.ts";
import { recoverAll } from "./composition/recovery.ts";
import { health } from "./composition/health.ts";
import { consumeWakeBatch, type WakeMessage } from "./composition/wake-consumer.ts";
import { MemoryFanout } from "../adapters/events/fanout/memory.ts";
import { submissionEventId } from "../adapters/events/submission-events.ts";
import type { FanoutSubscriber } from "../adapters/events/fanout/publisher.ts";

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
  RUNNER_WAKE?: { fetch(request: Request): Promise<Response> };
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
function socketStub(env: Env, stream: NoticeStream, id: string) {
  return env.SOCKETS.get(env.SOCKETS.idFromName(`socket:${stream}:${id}`));
}
function notices(env: Env) {
  return {
    publish: (stream: NoticeStream, notice: Notice) =>
      socketStub(env, stream, notice.aggregateId).publish(notice),
  };
}
const realtimeStreams = ["submission", "interview", "match"] as const;
async function publishNotices(
  env: Env,
  run: ReturnType<typeof runFor>,
  streams: readonly NoticeStream[],
) {
  const store = postgresDispatch(run),
    publisher = notices(env),
    queue = wake(env);
  for (const stream of streams) {
    try {
      await dispatchBatch(store, publisher, queue, stream);
    } catch {
      // The scheduled dispatcher retries retained notices.
    }
  }
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
/** Admission sends the durable wake even if the direct dispatch fails. */
function admissionWake(env: Env, deferred: boolean): ReturnType<typeof wake> {
  const queue = wake(env),
    runner = env.RUNNER_WAKE;
  if (!runner || !deferred) return queue;
  return {
    async send(message, delaySeconds) {
      const direct = async () => {
        if (message.phase !== "continuation" || delaySeconds) return;
        try {
          const response = await runner.fetch(
            new Request("https://runner-wake.internal/internal/wake", {
              method: "POST",
              headers: { authorization: `Bearer ${required(env.EXECUTION_DRAIN_SECRET)}` },
              signal: AbortSignal.timeout(3000),
            }),
          );
          await response.body?.cancel();
        } catch {
          // The queue and outbox can recover the committed job.
        }
      };
      await Promise.all([queue.send(message, delaySeconds), direct()]);
    },
  };
}

let verifierCache: { origin: string; database: string; verifier: TokenVerifier } | undefined;
function makeSecurity(env: Env, signal?: AbortSignal) {
  const auth = workerRuntime(env, signal),
    origin = required(env.AUTH_ORIGIN);
  if (
    !verifierCache ||
    verifierCache.origin !== origin ||
    verifierCache.database !== env.DB.connectionString
  ) {
    verifierCache = {
      origin,
      database: env.DB.connectionString,
      verifier: jwtVerifier({
        issuer: origin,
        audience: "quorem-api",
        jwksURL: new URL("/api/auth/jwks", origin).href,
        fetch: async (input, init) =>
          workerRuntime(env, init?.signal ?? undefined).app.fetch(new Request(input, init)),
      }),
    };
  }
  const verifier = verifierCache.verifier;
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
function makeHttp(
  env: Env,
  request: Request,
  submissionNotices?: FanoutSubscriber,
  deferExecution?: (work: Promise<unknown>) => void,
) {
  const run = runFor(env, request.signal),
    security = makeSecurity(env, request.signal),
    allowed = origins(env);
  const identity = composeIdentity(run, security.verifier, security.sessions, allowed);
  const result = composeHttp({
    run,
    ...identity,
    origins: allowed,
    submissionNotices,
    deferExecution,
    trustedPeer: () => cloudflarePeer(request.headers, env.TRUST_CLOUDFLARE_PEER),
    deadline: cloudflareCoordinator(env.DEADLINES),
    execution: cloudflareCoordinator(env.EXECUTION_RECOVERY),
    wake: admissionWake(env, !!deferExecution),
    inviteKey: keyBytes(env.MATCH_INVITE_KEY),
    shards: boundedInt(env.DEADLINE_SHARDS, 1, 256),
    guestCreation: flag(env.GUEST_CREATION),
    guestAdmission: flag(env.GUEST_ADMISSION),
    guestExecution: flag(env.GUEST_EXECUTION),
    localStrongBypass: false,
  });
  result.app.route("/", security.auth.app);
  return { ...result, run, security };
}
function socketAuthority(env: Env) {
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
    guestCreation: flag(env.GUEST_CREATION),
    guestAdmission: flag(env.GUEST_ADMISSION),
    guestExecution: flag(env.GUEST_EXECUTION),
    localStrongBypass: false,
  });
  return postgresSocketAuthority({
    run,
    verifier: security.verifier,
    sessions: security.sessions,
    matches: composed.matches,
    afterInterviewCommand: async () => {
      await dispatchBatch(postgresDispatch(run), notices(env), wake(env), "interview");
    },
  });
}
const SocketObject = browserSocketObject<Env>((env) => {
  const base = socketAuthority(env);
  return {
    origins: origins(env),
    authority: {
      ...base,
      async issue(request) {
        const record = await base.issue(request);
        record.resourceId = record.resourceId.toLowerCase();
        if (request.headers.get("x-quorem-socket-scope") !== record.resourceId) {
          await base.release(record);
          throw new IdentityError("unauthorized");
        }
        return record;
      },
    },
  };
});
export class BrowserSockets extends SocketObject {
  private readonly submissionNotices = new MemoryFanout(8);

  private readonly bindings: Env;

  constructor(state: ConstructorParameters<typeof SocketObject>[0], bindings: Env) {
    super(state, bindings);
    this.bindings = bindings;
  }

  override async fetch(request: Request): Promise<Response> {
    const id = submissionEventId(new URL(request.url).pathname);
    if (!id) return super.fetch(request);
    if (request.headers.get("x-quorem-submission-scope") !== id)
      return new Response(null, { status: 403 });
    return makeHttp(this.bindings, request, this.submissionNotices).app.fetch(request);
  }

  override publish(notice: Notice): Promise<void> {
    if (notice.type === "submission.updated")
      return this.submissionNotices.publish(`/submissions/${notice.aggregateId}`, notice);
    return super.publish(notice);
  }
}
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
async function routeSocket(env: Env, request: Request, target: SocketTarget): Promise<Response> {
  const rejected = socketHandshake(request, origins(env));
  if (rejected) return new Response(null, { status: rejected });
  if (target.mode === "invalid") return new Response(null, { status: 404 });
  const { id } = target;
  const headers = new Headers(request.headers);
  headers.delete("x-quorem-socket-scope");
  headers.set("x-quorem-socket-scope", id);
  return socketStub(env, target.stream, id).fetch(new Request(request, { headers }));
}

let budget: ReturnType<typeof requestBudget> | undefined;
let streamBudget: ReturnType<typeof requestBudget> | undefined;
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: { waitUntil(work: Promise<unknown>): void },
  ): Promise<Response> {
    const defer = ctx ? (work: Promise<unknown>) => ctx.waitUntil(work) : undefined;
    const publish = async (streams: readonly NoticeStream[]) => {
      const work = publishNotices(env, runFor(env), streams);
      if (defer) defer(work);
      else await work;
    };
    try {
      const path = new URL(request.url).pathname,
        target = socketTarget(path);
      if (target && request.headers.get("upgrade")?.toLowerCase() === "websocket")
        return await routeSocket(env, request, target);
      const submissionId = request.method === "GET" && submissionEventId(path);
      if (submissionId) {
        streamBudget ??= requestBudget(boundedInt(env.HTTP_MAX_REQUESTS, 32, 1024));
        return await streamBudget(request, async () => {
          const headers = new Headers(request.headers);
          headers.set("x-quorem-submission-scope", submissionId);
          return socketStub(env, "submission", submissionId).fetch(
            new Request(request, { headers }),
          );
        });
      }
      budget ??= requestBudget(boundedInt(env.HTTP_MAX_REQUESTS, 32, 1024));
      if (path === "/health")
        return await budget(request, async () => health(request, origins(env)));
      return await budget(request, async () => {
        const run = runFor(env, request.signal);
        if (path.startsWith("/internal/runner/") || path.startsWith("/internal/verification/")) {
          const profile = judgingProfile();
          const handlers = await composePrivate(
            run,
            privateConfig(env),
            (peer) =>
              localJudgingDrain(
                peer,
                (terminal) => publish(terminal ? realtimeStreams : ["submission"]),
                judgingCapacity(env as unknown as Record<string, string | undefined>),
                profile,
              ),
            profile,
          );
          const response = path.startsWith("/internal/runner/")
            ? await handlers.runner(request)
            : await handlers.source(request);
          if (response.ok) {
            if (path === "/internal/runner/promote") await publish(realtimeStreams);
            else if (path === "/internal/runner/claim" || path === "/internal/runner/yield")
              await publish(["submission"]);
          }
          return privateResponse(response);
        }
        const composed = makeHttp(env, request, undefined, defer);
        const incoming = path.startsWith("/api/auth/")
          ? authPeerRequest(request, cloudflarePeer(request.headers, env.TRUST_CLOUDFLARE_PEER))
          : request;
        const response = await composed.app.fetch(incoming);
        if (response.status < 400 && !["GET", "HEAD", "OPTIONS"].includes(request.method))
          await publish(realtimeStreams);
        return response;
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "runtime-composition-failed",
          kind: error instanceof Error ? error.name : "unknown",
          frames:
            error instanceof Error
              ? error.stack
                  ?.split("\n")
                  .slice(1, 7)
                  .map((line) => line.match(/at ([A-Za-z0-9_.]+)/)?.[1])
                  .filter(Boolean)
              : [],
          reason:
            error instanceof Error &&
            /^(?:Invalid runtime (?:key|flag|limit)|Missing runtime configuration)$/.test(
              error.message,
            )
              ? error.message
              : undefined,
        }),
      );
      return unavailable();
    }
  },
  async queue(batch: { messages: readonly WakeMessage[] }, env: Env): Promise<void> {
    await consumeWakeBatch(batch.messages, { publisher: wake(env), ...drainConfig(env) });
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const run = runFor(env),
      store = postgresDispatch(run),
      publisher = notices(env);
    const deadlines = cloudflareCoordinator(env.DEADLINES),
      recovery = cloudflareCoordinator(env.EXECUTION_RECOVERY);
    await recoverAll([
      ...realtimeStreams.map((stream) => () => dispatchBatch(store, publisher, wake(env), stream)),
      async () => {
        await recoverExecutionIntents(run);
        await dispatchBatch(store, publisher, wake(env), "execution");
      },
      ...Array.from(
        { length: boundedInt(env.DEADLINE_SHARDS, 1, 256) },
        (_, shard) => () => deadlines.wake(shard),
      ),
      () => recovery.wake(0),
      () => retainBatch(run),
    ]);
  },
};
