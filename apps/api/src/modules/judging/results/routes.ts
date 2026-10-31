/** @file routes.ts @description Submission snapshot and cancellation transport. @module judging */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { Principal } from "../../identity/model.ts";
import type { SubmissionSnapshots } from "./model.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function submissionRoutes(deps: {
  snapshots: SubmissionSnapshots;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const actor = async (request: Request) => {
    const who = await identifyRequest((incoming) => deps.identify(incoming), request);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return who;
  };
  const id = (value: string) => {
    if (!uuid.test(value)) throw new ApplicationError("not_found", "Submission not found", 404);
    return value;
  };
  app.get("/v1/submissions/:id", async (c) =>
    c.body(await deps.snapshots.read(await actor(c.req.raw), id(c.req.param("id"))), 200, {
      "Content-Type": "application/json; charset=utf-8",
    }),
  );
  app.get("/v1/interviews/:interviewId/submissions/:id", async (c) =>
    c.body(
      await deps.snapshots.interview(
        await actor(c.req.raw),
        id(c.req.param("interviewId")),
        id(c.req.param("id")),
      ),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    ),
  );
  app.post("/v1/submissions/:id/cancel", async (c) => {
    const who = await actor(c.req.raw),
      key = c.req.header("Idempotency-Key");
    if (!key || new TextEncoder().encode(key).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    if (Number(c.req.header("Content-Length") ?? 0) > 1024)
      throw new ApplicationError("payload_too_large", "Invalid request body", 413);
    const reader = c.req.raw.body?.getReader(),
      decoder = new TextDecoder();
    let size = 0,
      body = "";
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Invalid request body", 413);
        }
        body += decoder.decode(value, { stream: true });
      }
    body += decoder.decode();
    if (body)
      try {
        const v: unknown = JSON.parse(body);
        if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length)
          throw new Error();
      } catch {
        throw new ApplicationError("invalid_input", "Invalid request body", 400);
      }
    return c.body(await deps.snapshots.cancel(who, id(c.req.param("id")), key), 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
  });
  return app;
}
