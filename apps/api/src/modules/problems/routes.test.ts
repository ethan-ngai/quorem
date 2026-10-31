import { expect, it } from "vitest";
import { problemRoutes } from "./routes.ts";
import { IdentityError } from "../identity/model.ts";
import type { ProblemQueries } from "./ports.ts";

it("uses injected identity, validates filters and returns contract errors", async () => {
  const calls: string[] = [];
  const queries: ProblemQueries = {
    catalog: async (actor, f) => {
      calls.push(`catalog:${actor?.userId ?? "anonymous"}:${f.limit}`);
      return '{"items":[],"total":0,"page":1,"limit":20,"topics":[],"companies":[]}';
    },
    bySlug: async (actor, slug) => {
      calls.push(`slug:${actor?.userId ?? "anonymous"}:${slug}`);
      return null;
    },
    byVersion: async () => null,
    editorials: async () => '{"items":[]}',
    candidates: async () => [],
  };
  const app = problemRoutes({
    queries,
    identify: async (req) => {
      calls.push("identify");
      if (req.headers.get("Authorization") === "bad") throw new IdentityError("unauthorized");
      return undefined;
    },
  });
  const response = await app.request("/v1/problems", {
    headers: { "X-Quorem-Owner": "victim", "X-Dev-User": "victim" },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ items: [], total: 0 });
  expect(calls).toEqual(["identify", "catalog:anonymous:20"]);
  const invalid = await app.request("/v1/problems?sort=hidden");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: "invalid_input" } });
  const missing = await app.request("/v1/problems/private");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
  expect((await app.request("/v1/problem-versions/not-a-uuid/solutions")).status).toBe(400);
  expect((await app.request("/v1/problems", { headers: { Authorization: "bad" } })).status).toBe(
    401,
  );
});
