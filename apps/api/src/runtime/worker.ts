import { reconcileParty } from "../adapters/postgres/parties/repository.ts";
/** @file worker.ts @description Worker HTTP, socket and durable recovery composition. @module api */
import { judgingCapacity, CASE_LANES, JUDGING_DEFAULTS } from "@quorem/execution";
// @ts-expect-error Workerd supplies this module.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import { workerRuntime, type AuthWorkerEnv } from "@quorem/auth/worker";
import { authPeerRequest, cloudflarePeer } from "@quorem/auth/peer";
import {
  IdentityError,
  type SessionAuthority,
  type TokenVerifier,
} from "../modules/identity/model.ts";
import { jwtVerifier } from "../adapters/identity/jwt.ts";
import { failureSummary } from "../application/error.ts";
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
import {
  occupiedDeadlineShards,
  postgresDeadlines,
} from "../adapters/postgres/events/scheduling/deadlines.ts";
import { prearmReceipts } from "../adapters/postgres/events/scheduling/prearm.ts";
import { reconcileScheduledMatch } from "../adapters/postgres/matches/reconcile/repository.ts";
import { matchDeadlineShard } from "../modules/events/scheduling/scheduling.ts";
import { postgresDispatch, recoverExecutionIntents } from "../adapters/postgres/events/dispatch.ts";
import { dispatchBatch, publishBatch } from "../modules/events/dispatch/dispatch.ts";
import type { Notice, NoticeStream } from "../modules/events/dispatch/ports.ts";
import { socketHandshake } from "./worker/socket/handshake.ts";
import { socketTarget, type SocketTarget } from "./worker/socket/target.ts";
import { browserSocketObject } from "./worker/socket/durable.ts";
import { postgresSocketAuthority } from "./worker/socket/authority.ts";
import { composeHttp } from "./composition/http.ts";
import { composeIdentity } from "./composition/identity.ts";
import { localJudgingDrain } from "./composition/judging-drain.ts";
import { judgingProfile } from "./composition/judging-profile.ts";
import { withJudgingConnections, withJudgingResponse } from "./composition/judging-connections.ts";
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
import { ActivityMaintenance } from "./composition/activity-maintenance.ts";
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
  EXECUTION_RECOVERY: {
    idFromName(name: string): unknown;
    get(id: unknown): CoordinatorStub & { scheduleMaintenance(): Promise<void> };
  };
  EXECUTION_QUEUE: QueueBinding;
  RUNNER_WAKE?: { fetch(request: Request): Promise<Response> };
  CASE_EXECUTION?: { fetch(request: Request): Promise<Response> };
  RESULT_VERIFIER?: { fetch(request: Request): Promise<Response> };
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
/** A separate instance reuses the execution binding without sharing admission alarm state. */
function scheduleMaintenance(env: Env): Promise<void> {
  const namespace = env.EXECUTION_RECOVERY;
  return namespace.get(namespace.idFromName("activity-maintenance")).scheduleMaintenance();
}

function trackActivity(env: Env, run: ReturnType<typeof runFor>): ReturnType<typeof runFor> {
  if (env.APP_ENV !== "production") return run;
  let armed: Promise<void> | undefined;
  return async (fn) => {
    await (armed ??= scheduleMaintenance(env));
    return run(fn);
  };
}

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
      await publishBatch(store, publisher, queue, stream);
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
function makeSecurity(env: Env, signal?: AbortSignal, run?: ReturnType<typeof runFor>) {
  const auth = workerRuntime(env, signal, undefined, run),
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
        // Internal key discovery must not consume the public endpoint's shared IP budget.
        fetch: async (_input, init) =>
          workerRuntime(env, init?.signal ?? undefined).auth.api.getJwks({ asResponse: true }),
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
  connection?: ReturnType<typeof runFor>,
) {
  const run = connection ?? runFor(env, request.signal),
    security = makeSecurity(env, request.signal, connection),
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
    beforeInterviewCommand:
      env.APP_ENV === "production" ? () => scheduleMaintenance(env) : undefined,
    afterInterviewCommand: async () => {
      await publishBatch(postgresDispatch(run), notices(env), wake(env), "interview");
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
            candidate.id.startsWith("party:")
              ? reconcileParty(tx, candidate.id.slice(6))
              : reconcileScheduledMatch(tx, candidate.id, candidate.generation),
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
async function repairWorker(
  env: Env,
  activity: boolean,
  retain: boolean,
  trackPending: boolean,
): Promise<boolean> {
  const run = runFor(env);
  const store = postgresDispatch(run);
  const publisher = notices(env);
  const queue = wake(env);
  const deadlines = cloudflareCoordinator(env.DEADLINES);
  let pending = false;
  const streams = [...realtimeStreams, "execution"] as const;
  await recoverAll([
    ...streams.map((stream) => async () => {
      if (stream === "execution") await recoverExecutionIntents(run);
      if (trackPending) {
        if ((await dispatchBatch(store, publisher, queue, stream)).pending) pending = true;
        if (stream === "execution") {
          const unfinished = await run((scope) =>
            scope.transaction(
              { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
              async (tx) =>
                (
                  await tx.execute(
                    sql`SELECT EXISTS(SELECT FROM execution_jobs WHERE NOT finished) AS pending`,
                  )
                ).rows[0]?.pending === true,
            ),
          );
          if (unfinished) pending = true;
        }
      } else {
        await publishBatch(store, publisher, queue, stream);
      }
    }),
    ...(activity
      ? [
          async () => {
            const count = boundedInt(env.DEADLINE_SHARDS, 1, 256);
            const shards = await occupiedDeadlineShards(run, count);
            await recoverAll(shards.map((shard) => () => deadlines.wake(shard)));
          },
          () => cloudflareCoordinator(env.EXECUTION_RECOVERY).wake(0),
        ]
      : []),
    ...(retain ? [() => retainBatch(run)] : []),
  ]);
  return pending;
}

export class ExecutionRecovery extends DurableObject {
  private actor: AdmissionRecovery;
  private maintenance: ActivityMaintenance;
  constructor(state: { storage: AdmissionAlarmStorage }, env: Env) {
    super(state, env);
    this.maintenance = new ActivityMaintenance(state.storage, (activity, retain) =>
      repairWorker(env, activity, retain, true),
    );
    const run = runFor(env);
    this.actor = new AdmissionRecovery(state.storage, prearmReceipts(run, "execution"), () =>
      dispatchBatch(postgresDispatch(run), notices(env), wake(env), "execution"),
    );
  }
  wake(shard: number) {
    return this.actor.wake(shard);
  }
  async scheduleMaintenance() {
    await this.maintenance.request();
  }
  async alarm() {
    if (await this.maintenance.initialized()) return this.maintenance.alarm();
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
let privateBudget: ReturnType<typeof requestBudget> | undefined;
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
      const privatePath =
        path.startsWith("/internal/runner/") || path.startsWith("/internal/verification/");
      const guard = privatePath
        ? (privateBudget ??= requestBudget(JUDGING_DEFAULTS.slots * (CASE_LANES * 2 + 1)))
        : budget;
      return await guard(request, async () => {
        const run = runFor(env, request.signal);
        const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
        if (privatePath) {
          const profile = judgingProfile();
          const execute = async (privateRun: ReturnType<typeof runFor>) => {
            const handlers = await composePrivate(
              profile.connection(
                /^\/internal\/runner\/(drain|promote|claim|yield)$/.test(path)
                  ? trackActivity(env, privateRun)
                  : privateRun,
              ),
              {
                ...privateConfig(env),
                wakeMatchDeadline: (id) =>
                  cloudflareCoordinator(env.DEADLINES).wake(
                    matchDeadlineShard(id, boundedInt(env.DEADLINE_SHARDS, 1, 256)),
                  ),
              },
              (peer) =>
                localJudgingDrain(
                  peer,
                  (terminal) => publish(terminal ? realtimeStreams : ["submission"]),
                  judgingCapacity(env as unknown as Record<string, string | undefined>),
                  {
                    profile,
                    fetch: env.CASE_EXECUTION
                      ? (input, init) => env.CASE_EXECUTION!.fetch(new Request(input, init))
                      : undefined,
                  },
                ),
              profile,
              env.RESULT_VERIFIER
                ? (input, init) => env.RESULT_VERIFIER!.fetch(new Request(input, init))
                : undefined,
              !!env.RESULT_VERIFIER,
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
          };
          // Replay reads checkpoint pages after returning its streaming response.
          if (path !== "/internal/runner/replay")
            return withJudgingConnections(env.DB.connectionString, request.signal, execute);
          return execute(run);
        }
        const handle = async (publicRun?: ReturnType<typeof runFor>) => {
          const shouldTrack =
            path.startsWith("/v1/") && (mutation || path.startsWith("/v1/parties"));
          const composed = makeHttp(
            env,
            request,
            undefined,
            defer,
            shouldTrack ? trackActivity(env, publicRun ?? run) : publicRun,
          );
          const incoming = path.startsWith("/api/auth/")
            ? authPeerRequest(request, cloudflarePeer(request.headers, env.TRUST_CLOUDFLARE_PEER))
            : request;
          const response = await composed.app.fetch(incoming);
          if (response.status < 400 && mutation) await publish(realtimeStreams);
          return response;
        };
        if (
          (request.method === "POST" && path === "/v1/submissions") ||
          (request.method === "GET" && /^\/v1\/submissions\/[0-9a-f-]{36}$/.test(path))
        ) {
          const profile = judgingProfile();
          return withJudgingResponse(
            env.DB.connectionString,
            request.signal,
            (scoped) => handle(profile.connection(scoped)),
            () =>
              console.log(
                JSON.stringify({
                  event: "public-judging-completed",
                  method: request.method,
                  ...JSON.parse(profile.header()),
                }),
              ),
          );
        }
        return handle();
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "runtime-composition-failed",
          ...failureSummary(error),
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
    if (env.APP_ENV === "production") return;
    await repairWorker(env, true, true, false);
  },
};
