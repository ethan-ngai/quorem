/** @file routes.ts @description Interview document HTTP transport. @module interviews */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { DocumentPush, InterviewDocuments } from "./model.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid document request", 400);
async function body(request: Request): Promise<{ batch: DocumentPush; raw: string }> {
  const reader = request.body?.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 256 * 1024) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Invalid request body", 413);
        }
        text += decoder.decode(part.value, { stream: true });
      }
    text += decoder.decode();
    const v = JSON.parse(text) as Record<string, unknown>;
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      Object.keys(v).some((k) => !["version", "epoch", "updates"].includes(k)) ||
      !Array.isArray(v.updates) ||
      v.updates.some(
        (u) =>
          !u ||
          typeof u !== "object" ||
          Array.isArray(u) ||
          Object.keys(u).some((k) => !["clientID", "changes"].includes(k)),
      )
    )
      throw invalid();
    return { batch: v as DocumentPush, raw: text };
  } catch (e) {
    if (e instanceof ApplicationError) throw e;
    throw invalid();
  }
}
export function interviewDocumentRoutes(deps: {
  documents: InterviewDocuments;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const actor = async (request: Request) => {
    const value = await identifyRequest((r) => deps.identify(r), request);
    if (!value)
      throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    return value;
  };
  app.get("/v1/interviews/:id/document", async (c) =>
    c.json(await deps.documents.read(await actor(c.req.raw), c.req.param("id"))),
  );
  app.get("/v1/interviews/:id/updates", async (c) => {
    const value = c.req.query("version");
    if (!value || !/^\d+$/.test(value)) throw invalid();
    return c.json(
      await deps.documents.pull(
        await actor(c.req.raw),
        c.req.param("id"),
        c.req.query("epoch") ?? "",
        Number(value),
      ),
    );
  });
  app.post("/v1/interviews/:id/updates", async (c) => {
    const who = await actor(c.req.raw),
      key = c.req.header("Idempotency-Key") ?? "";
    const { batch, raw } = await body(c.req.raw);
    return c.json(await deps.documents.push(who, c.req.param("id"), key, batch, raw));
  });
  return app;
}
