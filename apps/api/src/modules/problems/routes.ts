/** @file routes.ts @description Portable catalog HTTP transport. @module problems */
import { ApplicationError } from "../../application/error.ts";
import { bodyLimit } from "hono/body-limit";
import { Hono, type Context } from "hono";
import { identifyRequest } from "../identity/routes.ts";
import type { Principal } from "../identity/model.ts";
import type { ProblemQueries } from "./ports.ts";
import { parseCatalogFilter, readProblem, validateEditorialId } from "./queries.ts";

export interface ProblemRouteDependencies {
  readonly queries: ProblemQueries;
  readonly identify: (request: Request) => Promise<Principal | undefined>;
}
/** Build routes with identity resolved before a query may acquire a connection. */
export function problemRoutes(deps: ProblemRouteDependencies) {
  const app = new Hono();
  const actor = async (request: Request) => {
    const principal = await identifyRequest(deps.identify, request);
    return principal
      ? {
          userId: principal.userId,
          ...(principal.kind === "guest" ? { guestScope: principal.scope } : {}),
        }
      : undefined;
  };
  const json = (c: Context, body: string) =>
    c.body(body, 200, { "Content-Type": "application/json; charset=utf-8" });
  app.get("/v1/problems", async (c) => {
    const who = await actor(c.req.raw);
    return json(
      c,
      await deps.queries.catalog(who, parseCatalogFilter(new URL(c.req.url).searchParams)),
    );
  });
  app.post("/v1/recommendation-feedback", bodyLimit({ maxSize: 8192 }), async (c) => {
    const who = await actor(c.req.raw);
    if (!who || who.guestScope) throw new ApplicationError("forbidden", "Account required", 403);
    const body = await c.req.json<{ action?: unknown; ids?: unknown } | null>().catch(() => null);
    const ids = body?.ids,
      action = body?.action;
    if (
      (action !== "view" && action !== "dismiss") ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      (action === "dismiss" && ids.length !== 1) ||
      !ids.every(
        (id) => typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
      )
    )
      throw new ApplicationError("invalid_input", "Invalid recommendation feedback", 400);
    await deps.queries.recommendationFeedback(who.userId, ids, action);
    return c.body(null, 204);
  });
  app.get("/v1/problems/:slug", async (c) =>
    json(c, await readProblem(deps.queries, await actor(c.req.raw), c.req.param("slug"), false)),
  );
  app.get("/v1/question-publications/:id", async (c) =>
    json(c, await readProblem(deps.queries, await actor(c.req.raw), c.req.param("id"), true)),
  );
  for (const kind of ["solutions", "complexity"] as const)
    app.get(`/v1/question-publications/:id/${kind}`, async (c) => {
      const who = await actor(c.req.raw);
      const id = c.req.param("id");
      validateEditorialId(id);
      return json(c, await deps.queries.editorials(who, id, kind === "complexity"));
    });
  return app;
}
