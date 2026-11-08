/** @file routes.ts @description Question authoring HTTP transport. @module problems */
import { parseListQuery } from "../../../application/list-query.ts";
import { boundedUtf8Body } from "../../../application/json-body.ts";
import { parseCatalogFilter } from "../queries.ts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { AuthoringBatch, QuestionAuthoring } from "./ports.ts";
export interface AuthoringDependencies {
  readonly identify: (request: Request) => Promise<Principal | undefined>;
  readonly authoring: QuestionAuthoring;
  readonly allowLocalStrongBypass: boolean;
  readonly now: () => number;
}
const idSchema = z.guid();
const revision = z.string().regex(/^[1-9][0-9]{0,18}$/);
const deletion = z.strictObject({ revision });
const content = z.custom<{ [key: string]: JsonValue }>(
  (value) =>
    !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof JsonNumber),
);
const createDraft = z.union([
  z.strictObject({ content }),
  z.strictObject({ problemVersionId: idSchema }),
]);
const saveDraft = z.strictObject({ revision, content });
const visibility = z.enum(["private", "global"]);
const publishDraft = z.strictObject({
  revision,
  visibility: z.union([visibility, z.literal("")]).default(""),
});
const mutationItem = z.strictObject({ id: idSchema, revision });
const batchItems = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item).min(1).max(16) });
const bulkPublish = batchItems(mutationItem.extend({ visibility }));
const bulkDraftDelete = batchItems(mutationItem);
const bulkPublicationDelete = batchItems(z.strictObject({ id: idSchema }));
const bulkImport = batchItems(z.string());
const previewFlag = z.literal("1").optional();
const sourceFilter = z.enum(["leetcode", "other"]).optional();
const readinessFilter = z.enum(["ready", "needs-fixes"]).optional();
function invalid(message = "Invalid request body"): never {
  throw new ApplicationError("invalid_input", message, 400);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, message?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) invalid(message);
  return result.data;
}
async function body(request: Request, limit: number): Promise<{ [key: string]: JsonValue }> {
  const text = await boundedUtf8Body(request, limit);
  try {
    return parse(content, parseLosslessJson(text));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    return invalid();
  }
}
function draftId(id: string): void {
  parse(idSchema, id, "Invalid draft ID");
}
function mutationBatch(action: AuthoringBatch["action"], body: unknown): AuthoringBatch {
  switch (action) {
    case "publish":
      return { action, ...parse(bulkPublish, body) };
    case "delete-drafts":
      return { action, ...parse(bulkDraftDelete, body) };
    case "delete-publications":
      return { action, ...parse(bulkPublicationDelete, body) };
  }
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
  function filters(url: string) {
    const query = new URL(url).searchParams;
    const source = parse(
      sourceFilter,
      query.get("source") ?? undefined,
      "Invalid question filters",
    );
    const readiness = parse(
      readinessFilter,
      query.get("readiness") ?? undefined,
      "Invalid question filters",
    );
    if (query.has("cursor")) invalid("Cursor pagination is unsupported");
    const drafts = new URL(url).pathname.endsWith("question-drafts");
    const pagination = parseListQuery(
      query,
      drafts ? (["title", "difficulty", "updatedAt"] as const) : (["title", "difficulty"] as const),
      { page: 1, limit: 50, sort: drafts ? "updatedAt" : "title", order: drafts ? "desc" : "asc" },
    );
    const catalogQuery = new URLSearchParams(query);
    catalogQuery.set("sort", pagination.sort === "updatedAt" ? "title" : pagination.sort);
    const catalog = parseCatalogFilter(catalogQuery);
    return { ...catalog, ...pagination, sql: catalog.sql || ("false" as const), source, readiness };
  }
  app.get("/v1/admin/question-publications", async (c) => {
    const p = await principal(c.req.raw);
    return json(c, await deps.authoring.publications(p, filters(c.req.url)));
  });
  app.get("/v1/admin/question-drafts", async (c) => {
    const p = await principal(c.req.raw);
    return json(c, await deps.authoring.list(p, filters(c.req.url)));
  });
  app.get("/v1/admin/question-drafts/:id", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    return json(c, await deps.authoring.get(p, id));
  });
  app.post("/v1/admin/question-drafts", async (c) => {
    const p = await principal(c.req.raw);
    const req = parse(
      createDraft,
      await body(c.req.raw, (2 << 20) + 1024),
      "Provide content or problemVersionId",
    );
    return json(
      c,
      "content" in req
        ? await deps.authoring.create(p, stringifyLosslessJson(req.content), undefined)
        : await deps.authoring.create(p, undefined, req.problemVersionId),
      201,
    );
  });
  app.post("/v1/admin/question-drafts/import", async (c) => {
    const p = await principal(c.req.raw),
      preview = parse(previewFlag, c.req.query("preview"), "Invalid import preview");
    const raw = stringifyLosslessJson(await body(c.req.raw, 2 << 20));
    return json(c, await deps.authoring.importDraft(p, raw, preview === "1"));
  });
  app.post("/v1/admin/question-drafts/import-batch", async (c) => {
    const p = await principal(c.req.raw),
      preview = parse(previewFlag, c.req.query("preview"), "Invalid import preview");
    const { items } = parse(
      bulkImport,
      await body(c.req.raw, 5 << 20),
      "Choose 1 to 16 questions per request",
    );
    const encoder = new TextEncoder();
    if (items.reduce((bytes, item) => bytes + encoder.encode(item).length, 0) > 2 << 20)
      throw new ApplicationError("payload_too_large", "Question batch exceeds 2 MiB", 413);
    return json(c, await deps.authoring.importDraftBatch(p, items, preview === "1"));
  });
  for (const [path, action] of [
    ["/v1/admin/question-drafts/publish-batch", "publish"],
    ["/v1/admin/question-drafts/delete-batch", "delete-drafts"],
    ["/v1/admin/question-publications/delete-batch", "delete-publications"],
  ] as const) {
    app.post(path, async (c) => {
      const p = await principal(c.req.raw);
      const batch = mutationBatch(action, await body(c.req.raw, 16 << 10));
      const { items } = batch;
      if (new Set(items.map((item) => item.id)).size !== items.length)
        invalid("Choose each question only once");
      return json(
        c,
        await deps.authoring.mutateBatch(
          { ...p, globalAllowed: deps.allowLocalStrongBypass || p.strongUntil > deps.now() },
          batch,
        ),
      );
    });
  }
  app.put("/v1/admin/question-drafts/:id", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    const req = parse(saveDraft, await body(c.req.raw, (2 << 20) + 1024));
    return json(
      c,
      await deps.authoring.update(p, id, req.revision, stringifyLosslessJson(req.content)),
    );
  });
  app.delete("/v1/admin/question-drafts/:id", async (c) => {
    const p = await principal(c.req.raw);
    const id = c.req.param("id");
    draftId(id);
    const req = parse(deletion, await body(c.req.raw, 1024));
    return json(c, await deps.authoring.deleteDraft(p, id, req.revision));
  });
  app.get("/v1/admin/question-drafts/:id/deletion-impact", async (c) => {
    const p = await principal(c.req.raw);
    const id = c.req.param("id");
    draftId(id);
    return json(c, await deps.authoring.deletionImpact(p, id));
  });
  app.delete("/v1/admin/question-drafts/:id/publication", async (c) => {
    const p = await principal(c.req.raw);
    const id = c.req.param("id");
    draftId(id);
    const req = parse(deletion, await body(c.req.raw, 1024));
    return json(
      c,
      await deps.authoring.deletePublication(
        { ...p, globalAllowed: deps.allowLocalStrongBypass || p.strongUntil > deps.now() },
        id,
        req.revision,
      ),
    );
  });
  app.post("/v1/admin/question-drafts/:id/publish", async (c) => {
    const p = await principal(c.req.raw),
      id = c.req.param("id");
    draftId(id);
    const req = parse(publishDraft, await body(c.req.raw, 1024));
    return json(c, await deps.authoring.publish(p, id, req.revision, req.visibility));
  });
  return app;
}
