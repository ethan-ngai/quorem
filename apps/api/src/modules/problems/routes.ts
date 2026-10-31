/** @file routes.ts @description Portable catalog HTTP transport. @module problems */
import { Hono } from "hono";
import { ApplicationError } from "../../application/error.ts";
import { IdentityError } from "../identity/model.ts";
import type { Principal } from "../identity/model.ts";
import type { ProblemQueries } from "./ports.ts";
import { parseCatalogFilter, readProblem, validateEditorialId } from "./queries.ts";

export interface ProblemRouteDependencies {
  readonly queries: ProblemQueries;
  readonly identify: (request: Request) => Promise<Principal | undefined>;
}
/** Build routes with identity resolved before a query may acquire a connection. */
export function problemRoutes(deps: ProblemRouteDependencies) {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.onError((error, c) => {
    const known = error instanceof ApplicationError;
    const identity = error instanceof IdentityError;
    const status = known ? error.status : identity && error.kind === "unauthorized" ? 401 : 503;
    return c.json(
      {
        error: {
          code: known ? error.code : status === 401 ? "unauthenticated" : "temporarily_unavailable",
          message: known
            ? error.message
            : status === 401
              ? "Invalid credentials"
              : "Service unavailable",
          requestId: c.get("requestId") ?? crypto.randomUUID(),
        },
      },
      { status },
    );
  });
  const actor = async (request: Request) => {
    const principal = await deps.identify(request);
    return principal ? { userId: principal.userId } : undefined;
  };
  const json = (body: string) =>
    new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  app.get("/v1/problems", async (c) => {
    const who = await actor(c.req.raw);
    return json(
      await deps.queries.catalog(who, parseCatalogFilter(new URL(c.req.url).searchParams)),
    );
  });
  app.get("/v1/problems/:slug", async (c) =>
    json(await readProblem(deps.queries, await actor(c.req.raw), c.req.param("slug"), false)),
  );
  app.get("/v1/problem-versions/:id", async (c) =>
    json(await readProblem(deps.queries, await actor(c.req.raw), c.req.param("id"), true)),
  );
  for (const kind of ["solutions", "complexity"] as const)
    app.get(`/v1/problem-versions/:id/${kind}`, async (c) => {
      const who = await actor(c.req.raw);
      const id = c.req.param("id");
      validateEditorialId(id);
      return json(await deps.queries.editorials(who, id, kind === "complexity"));
    });
  return app;
}
