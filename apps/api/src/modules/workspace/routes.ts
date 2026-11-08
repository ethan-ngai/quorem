/** @file routes.ts @description Workspace HTTP transport. @module workspace */
import { jsonObjectBody } from "../../application/json-body.ts";
import { Hono, type Context } from "hono";
import { ApplicationError } from "../../application/error.ts";
import { identifyRequest } from "../identity/routes.ts";
import type { Principal } from "../identity/model.ts";
import type { WorkspaceLanguage, WorkspaceRepository } from "./model.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const languages: readonly string[] = ["python", "java", "typescript", "ocaml", "postgresql"];
export interface WorkspaceRouteDependencies {
  repository: WorkspaceRepository;
  identify(request: Request): Promise<Principal | undefined>;
}

export function workspaceRoutes(deps: WorkspaceRouteDependencies): Hono {
  const app = new Hono();
  const actor = async (request: Request): Promise<Principal> => {
    const principal = await identifyRequest((incoming) => deps.identify(incoming), request);
    if (!principal) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    return principal;
  };
  const json = (c: Context, result: string) =>
    c.body(result, 200, { "Content-Type": "application/json; charset=utf-8" });
  app.post("/v1/workspaces", async (c) => {
    const who = await actor(c.req.raw);
    const value = await jsonObjectBody(c.req.raw, 4096);
    if (Object.keys(value).some((key) => key !== "problemVersionId" && key !== "language"))
      throw new ApplicationError("invalid_input", "Invalid request body", 400);
    if (typeof value.problemVersionId !== "string" || !uuid.test(value.problemVersionId))
      throw new ApplicationError("invalid_input", "Invalid problem ID", 400);
    if (typeof value.language !== "string" || !languages.includes(value.language))
      throw new ApplicationError("invalid_input", "Unsupported language", 400);
    return c.json(
      await deps.repository.create(
        who,
        value.problemVersionId,
        value.language as WorkspaceLanguage,
      ),
      201,
    );
  });
  app.get("/v1/workspaces/:id", async (c) => {
    const who = await actor(c.req.raw);
    const id = c.req.param("id");
    if (!uuid.test(id)) throw new ApplicationError("not_found", "Workspace not found", 404);
    return c.json(await deps.repository.read(who, id));
  });
  app.get("/v1/workspaces/:id/problem", async (c) => {
    const who = await actor(c.req.raw);
    const id = c.req.param("id");
    if (!uuid.test(id)) throw new ApplicationError("not_found", "Workspace not found", 404);
    return c.body(await deps.repository.problem(who, id), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });
  app.get("/v1/workspaces/:id/odyssey", async (c) => {
    const who = await actor(c.req.raw);
    const id = c.req.param("id");
    if (!uuid.test(id)) throw new ApplicationError("invalid_input", "Invalid workspace", 400);
    return c.body(await deps.repository.odyssey(who, id), 200, {
      "Content-Type": "application/json; charset=utf-8",
    });
  });
  app.post("/v1/workspaces/:id/odyssey/reset", async (c) => {
    const who = await actor(c.req.raw);
    const id = c.req.param("id");
    if (!uuid.test(id)) throw new ApplicationError("invalid_input", "Invalid workspace", 400);
    return json(c, await deps.repository.reset(who, id));
  });
  return app;
}
