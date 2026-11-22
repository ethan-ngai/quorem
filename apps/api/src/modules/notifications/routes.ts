/** @file routes.ts @description Authenticated social and notification HTTP API. @module notifications */
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import { jsonObjectBody } from "../../application/json-body.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { Principal } from "../identity/model.ts";
import type { AcceptInvitation, FriendAction, Notifications, NotificationChange } from "./model.ts";
import { browserPushEndpoint } from "./subscription.ts";

const actions = new Set<FriendAction>([
  "request",
  "accept",
  "decline",
  "remove",
  "block",
  "unblock",
]);
const invalid = () => new ApplicationError("invalid_input", "Invalid notification request", 400);

function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw invalid();
  return value;
}

export function notificationRoutes(deps: {
  identify: (request: Request) => Promise<Principal | undefined>;
  inbox: Notifications;
  accept: AcceptInvitation;
  publish: (change: NotificationChange) => void;
  publicKey: string | null;
}) {
  const { inbox, identify, publish } = deps;
  const actor = async (request: Request) => {
    const who = await identifyRequest(identify, request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    if (who.kind === "guest") throw new ApplicationError("forbidden", "Account required", 403);
    return who;
  };
  const input = (request: Request) => jsonObjectBody(request, 4096);
  const app = new Hono();

  app.get("/v1/notifications/unread", async (c) =>
    c.json({ unread: await inbox.unread((await actor(c.req.raw)).userId) }),
  );
  app.post("/v1/notifications/open", async (c) =>
    c.json(await inbox.inbox((await actor(c.req.raw)).userId, true)),
  );
  app.post("/v1/notifications/:id/accept-invite", async (c) => {
    const who = await actor(c.req.raw);
    const id = uuid(c.req.param("id"));
    const key = c.req.header("Idempotency-Key");
    if (!key || key.length > 128) throw invalid();
    const party = await deps.accept(who, key, id);
    publish({ owner: who.userId });
    return c.json(party);
  });
  app.get("/v1/friends", async (c) =>
    c.json(await inbox.contacts((await actor(c.req.raw)).userId)),
  );
  app.get("/v1/friends/:player", async (c) =>
    c.json({
      state: await inbox.contact((await actor(c.req.raw)).userId, uuid(c.req.param("player"))),
    }),
  );
  app.post("/v1/friends/:player", async (c) => {
    const who = await actor(c.req.raw);
    const body = await input(c.req.raw);
    const action = body.action as FriendAction;
    if (!actions.has(action)) throw invalid();
    const change = await inbox.friend(who.userId, uuid(c.req.param("player")), action);
    if (change) publish(change);
    return c.json({ ok: true });
  });
  app.post("/v1/parties/:party/direct-invitations", async (c) => {
    const who = await actor(c.req.raw);
    const body = await input(c.req.raw);
    const change = await inbox.invite(who.userId, uuid(c.req.param("party")), uuid(body.player));
    if (change) publish(change);
    return c.json({ ok: true });
  });
  app.get("/v1/notifications/settings", async (c) =>
    c.json({
      publicKey: deps.publicKey,
      preferences: await inbox.preferences((await actor(c.req.raw)).userId),
    }),
  );
  app.put("/v1/notifications/settings", async (c) => {
    const who = await actor(c.req.raw);
    const { friend_request, match_invite } = await input(c.req.raw);
    if (typeof friend_request !== "boolean" || typeof match_invite !== "boolean") throw invalid();
    await inbox.setPreferences(who.userId, { friend_request, match_invite });
    return c.json({ ok: true });
  });
  app.put("/v1/notifications/push-subscription", async (c) => {
    const who = await actor(c.req.raw);
    const { endpoint, p256dh, auth } = await input(c.req.raw);
    const service = browserPushEndpoint(endpoint);
    if (
      !service ||
      typeof p256dh !== "string" ||
      !/^B[A-Za-z0-9_-]{86}$/.test(p256dh) ||
      typeof auth !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/.test(auth)
    )
      throw invalid();
    await inbox.subscribe(who.userId, { endpoint: service, keys: { p256dh, auth } });
    return c.json({ ok: true });
  });
  app.delete("/v1/notifications/push-subscription", async (c) => {
    const who = await actor(c.req.raw);
    const endpoint = browserPushEndpoint((await input(c.req.raw)).endpoint);
    if (!endpoint) throw invalid();
    await inbox.unsubscribe(who.userId, endpoint);
    return c.json({ ok: true });
  });
  app.delete("/v1/notifications/:id", async (c) => {
    const who = await actor(c.req.raw);
    await inbox.dismiss(who.userId, uuid(c.req.param("id")));
    publish({ owner: who.userId });
    return c.json({ ok: true });
  });
  return app;
}
