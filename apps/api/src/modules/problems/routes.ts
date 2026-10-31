/** @file routes.ts @description Portable catalog HTTP transport. @module problems */
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
    return principal ? { userId: principal.userId } : undefined;
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
  app.get("/v1/problems/:slug", async (c) =>
    json(c, await readProblem(deps.queries, await actor(c.req.raw), c.req.param("slug"), false)),
  );
  app.get("/v1/problem-versions/:id", async (c) =>
    json(c, await readProblem(deps.queries, await actor(c.req.raw), c.req.param("id"), true)),
  );
  for (const kind of ["solutions", "complexity"] as const)
    app.get(`/v1/problem-versions/:id/${kind}`, async (c) => {
      const who = await actor(c.req.raw);
      const id = c.req.param("id");
      validateEditorialId(id);
      return json(c, await deps.queries.editorials(who, id, kind === "complexity"));
    });
  return app;
}
