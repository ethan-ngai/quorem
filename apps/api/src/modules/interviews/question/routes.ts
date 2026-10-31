/** @file routes.ts @description Interview question HTTP transport. @module interviews */
import { Hono } from "hono";
import { JsonNumber, parseLosslessJson } from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { InterviewQuestions, HintVisibility } from "./model.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
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
export function interviewQuestionRoutes(deps: {
  questions: InterviewQuestions;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const actor = async (req: Request) => {
    const who = await identifyRequest((r) => deps.identify(r), req);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    return who;
  };
  const id = (value: string) => {
    if (!uuid.test(value)) throw new ApplicationError("not_found", "Interview unavailable", 404);
    return value;
  };
  const key = (req: Request) => {
    const value = req.headers.get("Idempotency-Key");
    if (!value || new TextEncoder().encode(value).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    return value;
  };
  const invalid = () => new ApplicationError("invalid_input", "Invalid interview command", 400);
  app.put("/v1/interviews/:id/question", async (c) => {
    let rawBody = "";
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      q = await body(c.req.raw, 256 * 1024, (raw) => {
        rawBody = raw;
      });
    return c.body(
      await deps.questions.select(who, id(c.req.param("id")), operation, q, rawBody),
      200,
      {
        "Content-Type": "application/json; charset=utf-8",
      },
    );
  });
  app.post("/v1/interviews/:id/hints", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      h = await body(c.req.raw, 1024);
    if (
      Object.keys(h).some((k) => !["topics", "complexity"].includes(k)) ||
      Object.values(h).some((v) => v !== null && typeof v !== "boolean")
    )
      throw invalid();
    return c.body(
      await deps.questions.hints(who, id(c.req.param("id")), operation, h as HintVisibility),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  app.post("/v1/interviews/:id/language", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      v = await body(c.req.raw, 1024);
    if (
      Object.keys(v).some((k) => !["language", "epoch"].includes(k)) ||
      typeof v.language !== "string" ||
      typeof v.epoch !== "string"
    )
      throw invalid();
    return c.body(
      await deps.questions.language(who, id(c.req.param("id")), operation, v.language, v.epoch),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  app.post("/v1/interviews/:id/pass-stage", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      v = await body(c.req.raw, 1024);
    if (
      Object.keys(v).some((k) => !["questionEpoch", "level"].includes(k)) ||
      typeof v.questionEpoch !== "string" ||
      !(v.level instanceof JsonNumber) ||
      !/^\d+$/.test(v.level.lexeme)
    )
      throw invalid();
    return c.body(
      await deps.questions.passStage(
        who,
        id(c.req.param("id")),
        operation,
        v.questionEpoch,
        Number(v.level.lexeme),
      ),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  app.post("/v1/interviews/:id/cases/:caseId/visibility", async (c) => {
    const who = await actor(c.req.raw),
      operation = key(c.req.raw),
      v = await body(c.req.raw, 128);
    if (
      Object.keys(v).some((k) => !["questionEpoch", "revealed"].includes(k)) ||
      typeof v.questionEpoch !== "string" ||
      typeof v.revealed !== "boolean"
    )
      throw invalid();
    return c.body(
      await deps.questions.caseVisibility(
        who,
        id(c.req.param("id")),
        operation,
        c.req.param("caseId"),
        v.revealed,
        v.questionEpoch,
      ),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  return app;
}
