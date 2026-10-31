import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshot } from "../question/snapshot.ts";
import { interviewPresence } from "./repository.ts";
import { interviewMonitoring } from "../monitoring/repository.ts";
import { interviewPresenceRoutes } from "../../../../modules/interviews/presence/routes.ts";
import { interviewMonitoringRoutes } from "../../../../modules/interviews/monitoring/routes.ts";
const url = (env as unknown as { INTERVIEW_PRESENCE_URL: string }).INTERVIEW_PRESENCE_URL;
it("uses workerd PostgreSQL leases and private monitoring", async () => {
  const db = new URL(url);
  expect([db.hostname, db.port, db.pathname]).toEqual([
    "127.0.0.1",
    "55469",
    "/quorem_hono_interview_presence_test",
  ]);
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, fn);
  const host = `worker-host-${crypto.randomUUID()}`,
    candidate = `worker-candidate-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name) VALUES(${host},'Host'),(${candidate},'Candidate')`,
      );
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${host},'interviews.host','manual','test','test','test')`,
      );
    }),
  );
  const identity = (id: string) => run((scope) => developmentIdentity(scope, id)),
    hostActor = (await identity(host))!,
    candidateActor = (await identity(candidate))!;
  const lifecycle = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshot,
  });
  const room = JSON.parse(
    await lifecycle.create(hostActor, "create", {
      title: "Worker",
      question: { problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7", language: "python" },
    }),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${room.id}::uuid,${candidate},'interviewee')`,
      );
    }),
  );
  const first = interviewPresence(run),
    second = interviewPresence(run),
    monitor = interviewMonitoring(run, interviewSnapshot);
  const leases = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => (i % 2 ? first : second).acquire(candidateActor, room.id)),
  );
  const active = leases.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
  expect(active).toHaveLength(4);
  await first.release(candidateActor, room.id, active[0]);
  const again = await second.acquire(candidateActor, room.id);
  expect(await first.renew(candidateActor, room.id, again)).toBe(true);
  const app = createApp({ allowedOrigins: [], requestId: () => "worker" })
    .route("/", interviewPresenceRoutes({ presence: first, identify: () => identity(candidate) }))
    .route(
      "/",
      interviewMonitoringRoutes({ monitoring: monitor, identify: () => identity(candidate) }),
    );
  const base = `/v1/interviews/${room.id}`;
  const presence = await app.request(`${base}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientID: "tab",
      epoch: room.document.epoch,
      version: 0,
      anchor: 0,
      head: 0,
    }),
  });
  expect(presence.status).toBe(200);
  const rule = () =>
    app.request(`${base}/rule-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "event" },
      body: '{"kind":"paste"}',
    });
  expect((await rule()).status).toBe(200);
  expect((await rule()).status).toBe(200);
  expect(JSON.parse(await lifecycle.read(hostActor, room.id)).ruleEvents).toHaveLength(1);
  expect(JSON.parse(await lifecycle.read(candidateActor, room.id)).ruleEvents).toBeUndefined();
  const bad = await app.request(`${base}/rule-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "bad" },
    body: '{"kind":"paste","clipboard":"secret"}',
  });
  expect(bad.status).toBe(400);
});
