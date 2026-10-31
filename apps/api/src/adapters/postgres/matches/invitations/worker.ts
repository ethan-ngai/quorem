/** @file worker.ts @description Workerd invitation transport against disposable PostgreSQL. @module matches */
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { publicGuestBudget } from "../../identity/guest.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { cloudflareCoordinator } from "../../../scheduling/cloudflare.ts";
import { matchLifecycle } from "../lifecycle/repository.ts";
import { matchInvitations } from "./repository.ts";
import { matchLanguageSelection } from "../selection/language.ts";
import { matchInvitationRoutes } from "../../../../modules/matches/invitations/routes.ts";
import { normalizeSettings } from "../../../../modules/matches/lifecycle/model.ts";
import { newGuestToken } from "../../../../modules/identity/guest/credentials.ts";

it("serves actual guest admission, origin and rotation with real PostgreSQL", async () => {
  const bindings = env as unknown as {
    MATCH_LIFECYCLE_URL: string;
    DEADLINES: {
      idFromName(name: string): unknown;
      get(id: unknown): { wake(n: number): Promise<void> };
    };
  };
  const url = new URL(bindings.MATCH_LIFECYCLE_URL);
  expect([url.hostname, url.port, url.pathname]).toEqual([
    "127.0.0.1",
    "55471",
    "/quorem_hono_invites_test",
  ]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(
      bindings.MATCH_LIFECYCLE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      f,
    );
  const owner = `worker-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO users(id,display_name,kind) VALUES(${owner},'Worker','account')`,
      );
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${owner},'matches.host_guests','manual','worker','fixture','test')`,
      );
    }),
  );
  const who = await run((scope) => developmentIdentity(scope, owner));
  const key = new Uint8Array(32).fill(3);
  const lifecycle = matchLifecycle(run, {
    inviteKey: key,
    receipts: prearmReceipts(run),
    coordinator: cloudflareCoordinator(bindings.DEADLINES),
    shards: 1,
    guestCreation: true,
  });
  const invites = matchInvitations(run, key);
  const created = (await lifecycle.create(
    who!,
    crypto.randomUUID(),
    normalizeSettings({ difficulty: "easy", accessMode: "guests_allowed" }),
  )) as { id: string; inviteUrl: string };
  const token = created.inviteUrl.slice("/invite/".length);
  const app = createApp({
    allowedOrigins: ["https://example.test"],
    requestId: () => "invites-worker",
  }).route(
    "/",
    matchInvitationRoutes({
      invitations: invites,
      language: matchLanguageSelection(run, key),
      identify: async () => who,
      allowedOrigins: ["https://example.test"],
      admissionEnabled: true,
      trustedPeer: () => "127.0.0.1",
      budget: { allow: (peer) => run((scope) => publicGuestBudget(scope).allow(peer)) },
    }),
  );
  const preview = await app.request(`/v1/match-invites/${token}`);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("referrer-policy")).toBe("no-referrer");
  const credential = newGuestToken();
  const join = (origin: string, cookie: string) =>
    app.request(`/v1/match-invites/${token}/guest`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: '{"name":"Guest"}',
    });
  expect((await join("https://evil.test", `quorem_guest=${credential}`)).status).toBe(403);
  expect(
    (await join("https://example.test", `quorem_guest=${credential}; quorem_guest=${credential}`))
      .status,
  ).toBe(401);
  const responses = await Promise.all([
    join("https://example.test", `quorem_guest=${credential}`),
    join("https://example.test", `quorem_guest=${credential}`),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const count = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ count: number }>(
            sql`SELECT guest_joins AS count FROM matches WHERE id=${created.id}::uuid`,
          )
        ).rows[0].count,
    ),
  );
  expect(count).toBe(1);
  const rotate = (await invites.rotate(who!, created.id, "worker-rotate")) as { inviteUrl: string };
  expect((await app.request(`/v1/match-invites/${token}`)).status).toBe(404);
  expect(
    (await app.request(`/v1/match-invites/${rotate.inviteUrl.slice("/invite/".length)}`)).status,
  ).toBe(200);
  await lifecycle.mutate(who!, created.id, "worker-close", "leave", null);
});
