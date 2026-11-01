/** @file routes.ts @description Question authoring HTTP transport. @module problems */
import { Hono, type Context } from "hono";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { QuestionAuthoring } from "./ports.ts";
export interface AuthoringDependencies {
  readonly identify: (request: Request) => Promise<Principal | undefined>;
  readonly authoring: QuestionAuthoring;
  readonly allowLocalStrongBypass: boolean;
  readonly now: () => number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message = "Invalid request body"): never {
  throw new ApplicationError("invalid_input", message, 400);
}
function object(value: JsonValue): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    invalid();
  return value;
}
async function body(request: Request, limit: number): Promise<{ [key: string]: JsonValue }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader)
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > limit) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Invalid request body", 413);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return object(parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    return invalid();
  }
}
function fields(o: { [key: string]: JsonValue }, allowed: readonly string[]): void {
  if (Object.keys(o).some((k) => !allowed.includes(k))) invalid();
}
function text(v: JsonValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v !== "string") return invalid();
  return v;
}
function draftId(id: string): void {
  if (!uuid.test(id)) invalid("Invalid draft ID");
}
/** Routes rely on the injected identity transport and shared application error handler. */
export function authoringRoutes(deps: AuthoringDependencies) {
  const app = new Hono();
  const principal = async (request: Request) => {
    const p = await identifyRequest(deps.identify, request);
    if (!p?.userId) throw new ApplicationError("unauthorized", "Sign in required", 401);
    return p;
  };
  const json = (c: Context, value: string, status: 200 | 201 = 200) =>
    c.body(value, status, { "Content-Type": "application/json; charset=utf-8" });
  app.get("/v1/admin/question-drafts", async (c) => {
    const p = await principal(c.req.raw),
      cursor = c.req.query("cursor") ?? "";
    if (cursor && !uuid.test(cursor)) invalid("Invalid cursor");
    return json(c, await deps.authoring.list(p, cursor));
  });
  app.get("/v1/admin/question-drafts/:id", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    return json(c, await deps.authoring.get(p, id));
  });
  app.post("/v1/admin/question-drafts", async (c) => {
    const p = await principal(c.req.raw),
      req = await body(c.req.raw, (2 << 20) + 1024);
    fields(req, ["content", "problemVersionId"]);
    const id = text(req.problemVersionId),
      content =
        req.content === undefined || req.content === null
          ? undefined
          : stringifyLosslessJson(req.content);
    if ((content === undefined) === (id === "")) invalid("Provide content or problemVersionId");
    if (id && !uuid.test(id)) invalid("Invalid problem version");
    return json(c, await deps.authoring.create(p, content, id || undefined), 201);
  });
  app.put("/v1/admin/question-drafts/:id", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    const req = await body(c.req.raw, (2 << 20) + 1024);
    fields(req, ["revision", "content"]);
    if (req.content === undefined || req.content === null) invalid("Content required");
    return json(
      c,
      await deps.authoring.update(p, id, text(req.revision), stringifyLosslessJson(req.content)),
    );
  });
  app.post("/v1/admin/question-drafts/:id/publish", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    const req = await body(c.req.raw, 1024);
    fields(req, ["revision", "visibility"]);
    const visibility = text(req.visibility);
    if (visibility !== "" && visibility !== "private" && visibility !== "global")
      invalid("Choose private or global publication");
    if (
      visibility !== "private" &&
      p.admin &&
      !deps.allowLocalStrongBypass &&
      p.strongUntil <= deps.now()
    )
      throw new ApplicationError(
        "step_up_required",
        "Sign in with a verified passkey again before publishing globally",
        403,
      );
    return json(
      c,
      await deps.authoring.publish(
        { ...p, globalAllowed: deps.allowLocalStrongBypass || p.strongUntil > deps.now() },
        id,
        text(req.revision),
        visibility,
      ),
    );
  });
  return app;
}
