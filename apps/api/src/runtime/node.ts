/** @file node.ts @description Node API, socket and durable dispatch composition. @module api */
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { once } from "node:events";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { createNodeRuntime } from "@quorem/auth/node";
import { authPeerRequest, validPeer } from "@quorem/auth/peer";
import { IdentityError, type SessionAuthority } from "../modules/identity/model.ts";
import { jwtVerifier } from "../adapters/identity/jwt.ts";
import { nodeLocalIdentity } from "../adapters/identity/node-local.ts";
import { developmentIdentity } from "../adapters/postgres/identity/repository.ts";
import { sqsQueue } from "../adapters/delivery/sqs.ts";
import { SQSClient } from "@aws-sdk/client-sqs";
import { cloudflareRest } from "../adapters/delivery/cloudflare.ts";
import { PostgresFanout } from "../adapters/events/fanout/postgres.ts";
import { noticePublisher, socketSubscription } from "../adapters/events/fanout/publisher.ts";
import { postgresSocketAuthority } from "./worker/socket/authority.ts";
import { socketTarget } from "./worker/socket/target.ts";
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
import { privateResponse } from "./composition/private-response.ts";
import { recoverAll } from "./composition/recovery.ts";

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
  const disposers: (() => Promise<void> | void)[] = [() => pool.end()];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const failures: unknown[] = [];
      for (const dispose of disposers.reverse())
        try {
          await dispose();
        } catch (error) {
          failures.push(error);
        }
      if (failures.length) throw new AggregateError(failures, "Runtime shutdown failed");
    })());
  try {
    const auth = await createNodeRuntime(env);
    disposers.push(() => auth.database.end());
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
    const localSqs = env.SQS_LOCAL_ENDPOINT;
    if (localSqs) {
      const endpoint = new URL(localSqs);
      if (
        env.APP_ENV !== "local" ||
        endpoint.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.pathname !== "/" ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error("Invalid local SQS endpoint");
    }
    const wake =
      provider === "sqs"
        ? sqsQueue(
            required(env.SQS_QUEUE_URL),
            localSqs
              ? new SQSClient({ endpoint: localSqs, useQueueUrlAsEndpoint: false })
              : undefined,
          )
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
    disposers.push(() => fanout.close());
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
    disposers.push(() => deadlines.close());
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
    disposers.push(() => recovery.close());
    const dispatch = async () => {
      await recoverAll([
        ...(["interview", "match", "submission", "membership"] as const).map(
          (name) => () => dispatchBatch(store, notices, wake, name),
        ),
        async () => {
          await recoverExecutionIntents(run);
          await dispatchBatch(store, notices, wake, "execution");
        },
      ]);
    };
    const stopListener = await startNodeNotifications(
      listenURL,
      () => {
        void dispatch().catch(report);
      },
      report,
    );
    disposers.push(stopListener);
    const repair = async () =>
      recoverAll([
        dispatch,
        ...Array.from({ length: shards }, (_, shard) => () => deadlines.wake(shard)),
        () => recovery.wake(0),
      ]);
    await repair().catch(report);
    const timer = setInterval(() => {
      void repair().catch(report);
    }, 60000);
    timer.unref();
    disposers.push(() => clearInterval(timer));
    const host = env.HOST ?? "127.0.0.1";
    if (env.APP_ENV === "local" && !["127.0.0.1", "localhost", "::1"].includes(host))
      throw new Error("Local runtime requires loopback");
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
      hostname: host,
      port: env.PORT === "0" ? 0 : boundedInt(env.PORT, 8080, 65535),
      fetch: async (request, info) =>
        budget(request, async () => {
          const path = new URL(request.url).pathname;
          const peer = validPeer(info.incoming.socket.remoteAddress);
          if (path.startsWith("/internal/runner/") || path.startsWith("/internal/verification/")) {
            const handlers = await composePrivate(runWith(request.signal), privateConfig(env));
            return privateResponse(
              await (path.startsWith("/internal/runner/")
                ? handlers.runner(request)
                : handlers.source(request)),
            );
          }
          const composed = build(request.signal, peer);
          const incoming = path.startsWith("/api/auth/") ? authPeerRequest(request, peer) : request;
          const response = await composed.app.fetch(incoming);
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
    disposers.push(async () => {
      if (!server.listening) return;
      const force = setTimeout(() => server.closeAllConnections(), 5000);
      force.unref();
      try {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } finally {
        clearTimeout(force);
      }
    });
    if (!server.listening) await once(server, "listening");
    const setup = build();
    const authority = postgresSocketAuthority({
      run,
      verifier,
      sessions,
      matches: setup.matches,
      submissions: setup.submissions,
      afterInterviewCommand: dispatch,
    });
    const heartbeatMs = boundedInt(env.SOCKET_HEARTBEAT_MS, 15000, 120000);
    if (heartbeatMs < 1000) throw new Error("Invalid socket heartbeat");
    const stopSockets = installNodeSockets(server, {
      origins: allowed,
      heartbeatMs,
      resolve: async (request) => {
        const target = socketTarget(new URL(request.url).pathname);
        if (!target || target.mode === "invalid") return undefined;
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
    disposers.push(stopSockets);
    return { server, close };
  } catch (error) {
    try {
      await close();
    } catch {
      /* Preserve the startup failure. */
    }
    throw error;
  }
}
if (import.meta.main) {
  startNodeRuntime()
    .then((runtime) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        void runtime.close().catch(() => {
          console.error("API shutdown failed");
          process.exitCode = 1;
        });
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    })
    .catch(() => {
      console.error("API runtime configuration failed");
      process.exitCode = 1;
    });
}
