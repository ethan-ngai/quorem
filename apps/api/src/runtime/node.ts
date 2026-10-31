/** @file node.ts @description Node API, socket and durable dispatch composition. @module api */
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { createNodeRuntime } from "@quorem/auth/node";
import { IdentityError, type SessionAuthority } from "../modules/identity/model.ts";
import { jwtVerifier } from "../adapters/identity/jwt.ts";
import { nodeLocalIdentity } from "../adapters/identity/node-local.ts";
import { developmentIdentity } from "../adapters/postgres/identity/repository.ts";
import { sqsQueue } from "../adapters/delivery/sqs.ts";
import { cloudflareRest } from "../adapters/delivery/cloudflare.ts";
import { PostgresFanout } from "../adapters/events/fanout/postgres.ts";
import { noticePublisher, socketSubscription } from "../adapters/events/fanout/publisher.ts";
import { postgresSocketAuthority } from "./worker/socket/authority.ts";
import { installNodeSockets } from "./node/socket/server.ts";
import { nodeCoordinator } from "../adapters/scheduling/shells.ts";
import { drainDeadlines } from "../modules/events/scheduling/scheduling.ts";
import { postgresDeadlines } from "../adapters/postgres/events/scheduling/deadlines.ts";
import { prearmReceipts } from "../adapters/postgres/events/scheduling/prearm.ts";
import { reconcileScheduledMatch } from "../adapters/postgres/matches/reconcile/repository.ts";
import { postgresDispatch, recoverExecutionIntents } from "../adapters/postgres/events/dispatch.ts";
import { dispatchBatch } from "../modules/events/dispatch/dispatch.ts";
import { startNodeNotifications } from "./composition/node-notifications.ts";
import { composeIdentity } from "./composition/identity.ts";
import { composeHttp } from "./composition/http.ts";
import { composePrivate } from "./composition/private.ts";
import { boundedInt, flag, keyBytes, privateConfig, required } from "./composition/config.ts";
import { requestBudget, unavailable } from "./composition/budget.ts";

/** The caller owns shutdown; every HTTP request owns its database cancellation scope. */
export async function startNodeRuntime(env: NodeJS.ProcessEnv = process.env) {
  const database = required(env.DATABASE_URL),
    listenURL = required(env.QUOREM_DATABASE_LISTEN_URL);
  const pool = createNodePool({
    connectionString: database,
    max: boundedInt(env.QUOREM_DATABASE_MAX_CONNS, 4, 64),
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const auth = await createNodeRuntime(env);
  const runWith =
    (signal?: AbortSignal) =>
    <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
      withNodeConnection(pool, { lifetimeMs: 30000, signal }, fn);
  const run = runWith();
  const origin = auth.config.origin;
  const verifier = jwtVerifier({
    issuer: origin,
    audience: "quorem-api",
    jwksURL: new URL("/api/auth/jwks", origin).href,
    fetch: async (input, init) => auth.app.fetch(new Request(input, init)),
  });
  const sessions: SessionAuthority = {
    async check(id, subject) {
      try {
        const value = await auth.repository.sessionAuthority(id, subject);
        if (!value.valid) throw new IdentityError("unauthorized");
        return { strongAt: value.strongAt };
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        throw new IdentityError("unavailable", error);
      }
    },
  };
  const allowed = required(env.QUOREM_ALLOWED_ORIGINS)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const provider = required(env.EXECUTION_WAKE_PROVIDER);
  const wake =
    provider === "sqs"
      ? sqsQueue(required(env.SQS_QUEUE_URL))
      : provider === "cloudflare-rest"
        ? cloudflareRest({
            accountId: required(env.CLOUDFLARE_ACCOUNT_ID),
            queueId: required(env.CLOUDFLARE_QUEUE_ID),
            token: required(env.CLOUDFLARE_QUEUE_TOKEN),
          })
        : (() => {
            throw new Error("Unsupported execution wake provider");
          })();
  const fanout = new PostgresFanout(database, listenURL);
  await fanout.start();
  const notices = noticePublisher(fanout),
    shards = boundedInt(env.DEADLINE_SHARDS, 1, 256),
    store = postgresDispatch(run);
  const report = () => {
    console.error("Runtime recovery unavailable");
  };
  const deadlineReceipts = prearmReceipts(run);
  const deadlines = nodeCoordinator(async (shard) => {
    const ids = await deadlineReceipts.list(shard),
      committed: string[] = [];
    let retry = ids.length === 64;
    for (const id of ids) {
      const state = await deadlineReceipts.settle(id);
      if (state === "pending") retry = true;
      else if (state === "committed") committed.push(id);
    }
    const delay = await drainDeadlines(
      postgresDeadlines(run),
      (candidate) =>
        run((scope) =>
          scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
            reconcileScheduledMatch(tx, candidate.id, candidate.generation),
          ),
        ),
      shard,
      shards,
    );
    for (const id of committed) await deadlineReceipts.acknowledge(id);
    return retry ? Math.min(delay ?? 1000, 1000) : delay;
  }, report);
  const receipts = prearmReceipts(run, "execution");
  const recovery = nodeCoordinator(async (shard) => {
    const ids = await receipts.list(shard),
      committed: string[] = [];
    let retry = ids.length === 64;
    for (const id of ids) {
      const state = await receipts.settle(id);
      if (state === "pending") retry = true;
      else if (state === "committed") committed.push(id);
    }
    const result = await dispatchBatch(store, notices, wake, "execution");
    if (!result.pending) for (const id of committed) await receipts.acknowledge(id);
    return result.pending || retry ? 1000 : null;
  }, report);
  const dispatch = async () => {
    await recoverExecutionIntents(run);
    for (const name of ["interview", "match", "submission", "membership", "execution"] as const)
      await dispatchBatch(store, notices, wake, name);
  };
  const stopListener = await startNodeNotifications(
    listenURL,
    () => {
      void dispatch().catch(report);
    },
    report,
  );
  const repair = async () => {
    await dispatch();
    for (let i = 0; i < shards; i++) await deadlines.wake(i);
    await recovery.wake(0);
  };
  await repair();
  const timer = setInterval(() => {
    void repair().catch(report);
  }, 60000);
  timer.unref();
  const identityMode = env.IDENTITY_MODE ?? "managed";
  if (identityMode !== "managed" && !(identityMode === "local" && env.APP_ENV === "local"))
    throw new Error("Invalid identity mode");
  const basePorts = {
    origins: allowed,
    deadline: deadlines,
    execution: recovery,
    wake,
    inviteKey: keyBytes(env.MATCH_INVITE_KEY),
    shards,
    guestAdmission: flag(env.GUEST_ADMISSION),
    guestExecution: flag(env.GUEST_EXECUTION),
    localStrongBypass: identityMode === "local",
  };
  const budget = requestBudget(boundedInt(env.HTTP_MAX_REQUESTS, 32, 1024));
  const build = (signal?: AbortSignal, peer?: string) => {
    const db = runWith(signal),
      identity = composeIdentity(db, verifier, sessions, allowed);
    const identify =
      identityMode === "local"
        ? async (request: Request) =>
            nodeLocalIdentity(request.headers, peer, (user) =>
              db((scope) => developmentIdentity(scope, user)),
            )
        : identity.identify;
    const composed = composeHttp({
      run: db,
      ...identity,
      identify,
      ...basePorts,
      trustedPeer: () => peer,
    });
    composed.app.route("/", auth.app);
    return { ...composed, run: db };
  };
  const server = serve({
    hostname: env.HOST ?? "127.0.0.1",
    port: env.PORT === "0" ? 0 : boundedInt(env.PORT, 8080, 65535),
    fetch: async (request, info) =>
      budget(request, async () => {
        const path = new URL(request.url).pathname;
        const peer = info.incoming.socket.remoteAddress;
        const composed = build(request.signal, peer);
        if (path.startsWith("/internal/runner/") || path.startsWith("/internal/verification/")) {
          const handlers = await composePrivate(composed.run, privateConfig(env));
          return path.startsWith("/internal/runner/")
            ? handlers.runner(request)
            : handlers.source(request);
        }
        const response = await composed.app.fetch(request);
        if (response.status < 400 && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
          try {
            await dispatch();
          } catch {
            report();
          }
        }
        return response;
      }).catch(() => unavailable()),
  }) as Server;
  const setup = build();
  const authority = postgresSocketAuthority({
    run,
    verifier,
    sessions,
    matches: setup.matches,
    submissions: setup.submissions,
    afterInterviewCommand: dispatch,
  });
  const stopSockets = installNodeSockets(server, {
    origins: allowed,
    resolve: async (request) => {
      if (
        !/^\/v1\/(?:memberships|(?:interviews|matches|match-invites|submissions)\/[^/]+)\/events$/.test(
          new URL(request.url).pathname,
        )
      )
        return undefined;
      const record = await authority.issue(request);
      let opened: Awaited<ReturnType<typeof authority.open>>;
      try {
        opened = await authority.open(record, crypto.randomUUID());
      } catch (error) {
        await authority.release(record);
        throw error;
      }
      const prefix = {
        interview: "interviews",
        match: "matches",
        invite: "match-invites",
        submission: "submissions",
        membership: "memberships",
      }[record.mode];
      return {
        ...opened,
        mode: record.mode,
        subscription: socketSubscription(fanout, `/${prefix}/${record.resourceId}`),
        release: () => authority.release(record),
      };
    },
  });
  return {
    server,
    async close() {
      clearInterval(timer);
      deadlines.close();
      recovery.close();
      await stopSockets();
      await stopListener();
      await fanout.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await Promise.all([pool.end(), auth.database.end()]);
    },
  };
}
if (import.meta.main)
  startNodeRuntime().catch(() => {
    console.error("API runtime configuration failed");
    process.exitCode = 1;
  });
