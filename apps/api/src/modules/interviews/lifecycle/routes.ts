/** @file routes.ts @description Interview lifecycle HTTP transport. @module interviews */
import { Hono, type Context } from "hono";
import { parseLosslessJson, JsonNumber } from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import { allowPublicGuestRequest, type GuestRequestBudget } from "../../access/guest.ts";
import { IdentityError, type Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import { guestCookie, guestOriginAllowed } from "../../identity/guest/credentials.ts";
import { guestSetCookie } from "../../identity/guest/cookie.ts";
import type { InterviewCreate, InterviewLifecycle, InterviewRole } from "./model.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Dependencies {
  lifecycle: InterviewLifecycle;
  identify(request: Request): Promise<Principal | undefined>;
  allowedOrigins: readonly string[];
  trustedPeer(): string | undefined;
  budget: GuestRequestBudget;
}
async function body(
  request: Request,
  limit: number,
  capture?: (raw: string) => void,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new ApplicationError("payload_too_large", "Invalid request body", 413);
  const reader = request.body?.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Invalid request body", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    text += decoder.decode();
    const value = parseLosslessJson(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
      throw new Error();
    capture?.(text || "{}");
    return value;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
export function interviewLifecycleRoutes(deps: Dependencies): Hono {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest((r) => deps.identify(r), request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    return who;
  };
  const id = (value: string) => {
    if (!uuid.test(value)) throw new ApplicationError("not_found", "Interview unavailable", 404);
    return value;
  };
  const key = (request: Request) => {
    const value = request.headers.get("Idempotency-Key");
    if (!value || new TextEncoder().encode(value).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    return value;
  };
  const json = (c: Context, value: string) =>
    c.body(value, 200, { "Content-Type": "application/json; charset=utf-8" });
  const budget = async () => {
    try {
      if (!(await allowPublicGuestRequest(deps.trustedPeer(), deps.budget)))
        throw new ApplicationError(
          "rate_limited",
          "Too many invitation requests; try again shortly",
          429,
        );
    } catch (error) {
      if (error instanceof IdentityError)
        throw new ApplicationError("temporarily_unavailable", "Service unavailable", 503);
      throw error;
    }
  };
  app.get("/v1/interviews", async (c) =>
    json(c, `[${(await deps.lifecycle.list(await actor(c.req.raw))).join(",")}]`),
  );
  app.post("/v1/interviews", async (c) => {
    let rawBody = "";
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      value = await body(c.req.raw, 256 * 1024, (raw) => {
        rawBody = raw;
      });
    if (
      Object.keys(value).some((k) => !["title", "question", "monitoring"].includes(k)) ||
      typeof value.title !== "string" ||
      !value.question
    )
      throw new ApplicationError("invalid_input", "Invalid interview command", 400);
    const result = await deps.lifecycle.create(who, operation, {
      ...value,
      rawBody,
    } as unknown as InterviewCreate);
    return c.body(result, 201, { "Content-Type": "application/json; charset=utf-8" });
  });
  app.get("/v1/interviews/:id", async (c) =>
    c.body(await deps.lifecycle.read(await actor(c.req.raw), id(c.req.param("id"))), 200, {
      "Content-Type": "application/json; charset=utf-8",
    }),
  );
  app.get("/v1/interview-invites/:token", async (c) => {
    await budget();
    c.header("Referrer-Policy", "no-referrer");
    return c.json(await deps.lifecycle.preview(c.req.param("token")));
  });
  app.post("/v1/interview-invites/:token/join", async (c) => {
    await budget();
    const origin = c.req.raw.headers.get("origin");
    if (!origin || !guestOriginAllowed("POST", origin, deps.allowedOrigins))
      throw new ApplicationError("forbidden", "Origin denied", 403);
    const value = await body(c.req.raw, 512);
    if (
      Object.keys(value).some((k) => k !== "name") ||
      (value.name !== undefined && typeof value.name !== "string")
    )
      throw new ApplicationError("invalid_input", "Invalid guest name", 400);
    let credential: string | undefined;
    try {
      credential = guestCookie(c.req.raw.headers, "interview");
    } catch (error) {
      if (error instanceof IdentityError)
        throw new ApplicationError("unauthenticated", "Invalid credentials", 401);
      throw error;
    }
    const authenticate =
      c.req.raw.headers.has("authorization") ||
      c.req.raw.headers.has("x-dev-user") ||
      credential === undefined;
    const who = authenticate
      ? await identifyRequest((r) => deps.identify(r), c.req.raw)
      : undefined;
    const result = await deps.lifecycle.join(
      who,
      c.req.param("token"),
      credential,
      typeof value.name === "string" ? value.name : "",
    );
    if (result.credential)
      c.header("Set-Cookie", guestSetCookie("interview", result.credential, origin, 86400));
    c.header("Referrer-Policy", "no-referrer");
    return c.json({ id: result.id });
  });
  app.post("/v1/interviews/:id/members", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      value = await body(c.req.raw, 4096);
    if (
      Object.keys(value).some((k) => !["userId", "role"].includes(k)) ||
      typeof value.userId !== "string" ||
      (value.role !== "interviewer" && value.role !== "interviewee")
    )
      throw new ApplicationError("invalid_input", "Invalid interview role", 400);
    return json(
      c,
      await deps.lifecycle.setMember(
        who,
        id(c.req.param("id")),
        operation,
        value.userId,
        value.role as InterviewRole,
      ),
    );
  });
  app.post("/v1/interviews/:id/members/:userId/remove", async (c) =>
    json(
      c,
      await deps.lifecycle.removeMember(
        await actor(c.req.raw),
        id(c.req.param("id")),
        key(c.req.raw),
        c.req.param("userId"),
      ),
    ),
  );
  app.post("/v1/interviews/:id/admission", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      value = await body(c.req.raw, 1024);
    if (Object.keys(value).some((k) => k !== "locked") || typeof value.locked !== "boolean")
      throw new ApplicationError("invalid_input", "Specify room lock state", 400);
    return json(
      c,
      await deps.lifecycle.setAdmission(who, id(c.req.param("id")), operation, value.locked),
    );
  });
  app.post("/v1/interviews/:id/close", async (c) =>
    json(
      c,
      await deps.lifecycle.close(await actor(c.req.raw), id(c.req.param("id")), key(c.req.raw)),
    ),
  );
  app.delete("/v1/interviews/:id", async (c) => {
    await deps.lifecycle.delete(await actor(c.req.raw), id(c.req.param("id")));
    return c.json({ deleted: true });
  });
  return app;
}
