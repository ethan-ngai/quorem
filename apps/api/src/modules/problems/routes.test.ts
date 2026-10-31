import { expect, it } from "vitest";
import { problemRoutes } from "./routes.ts";
import { createApp } from "../../app.ts";
import { ApplicationError } from "../../application/error.ts";
import { IdentityError } from "../identity/model.ts";
import type { ProblemQueries } from "./ports.ts";

it("uses injected identity, validates filters and returns contract errors", async () => {
  const calls: string[] = [];
  const queries: ProblemQueries = {
    catalog: async (actor, f) => {
      calls.push(`catalog:${actor?.userId ?? "anonymous"}:${f.limit}`);
      if (f.query === "rate") throw new ApplicationError("rate_limited", "Try again", 429);
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
  const routes = problemRoutes({
    queries,
    identify: async (req) => {
      calls.push("identify");
      if (req.headers.get("Authorization") === "bad") throw new IdentityError("unauthorized");
      return undefined;
    },
  });
  const app = createApp({ allowedOrigins: [], requestId: () => "request-test" }).route("/", routes);
  const response = await app.request("/v1/problems", {
    headers: { "X-Quorem-Owner": "victim", "X-Dev-User": "victim" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-ID")).toBe("request-test");
  expect(await response.json()).toMatchObject({ items: [], total: 0 });
  expect(calls).toEqual(["identify", "catalog:anonymous:20"]);
  const invalid = await app.request("/v1/problems?sort=hidden");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: "invalid_input" } });
  const rate = await app.request("/v1/problems?q=rate");
  expect(rate.status).toBe(429);
  expect(rate.headers.get("Retry-After")).toBe("6");
  expect(rate.headers.get("Cache-Control")).toBe("no-store");
  expect(rate.headers.get("X-Request-ID")).toBe("request-test");
  expect(await rate.json()).toMatchObject({ error: { requestId: "request-test" } });
  const missing = await app.request("/v1/problems/private");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
  expect((await app.request("/v1/problem-versions/not-a-uuid/solutions")).status).toBe(400);
  expect((await app.request("/v1/problems", { headers: { Authorization: "bad" } })).status).toBe(
    401,
  );
});
