/** @file routes.ts @description Interview monitoring HTTP transport. @module interviews */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { InterviewMonitoring, MonitoringPolicy, RuleKind } from "./model.ts";
import { advisoryBody } from "../presence/request.ts";
export function interviewMonitoringRoutes(deps: {
  monitoring: InterviewMonitoring;
  identify(request: Request): Promise<Principal | undefined>;
}): Hono {
  const app = new Hono();
  const who = async (r: Request) => {
    const actor = await identifyRequest((x) => deps.identify(x), r);
    if (!actor)
      throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    return actor;
  };
  app.post("/v1/interviews/:id/monitoring", async (c) => {
    const actor = await who(c.req.raw),
      key = c.req.header("Idempotency-Key") ?? "",
      value = await advisoryBody(c.req.raw);
    return c.body(
      await deps.monitoring.setPolicy(actor, c.req.param("id"), key, value as MonitoringPolicy),
      200,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  });
  app.post("/v1/interviews/:id/rule-events", async (c) => {
    const actor = await who(c.req.raw),
      key = c.req.header("Idempotency-Key") ?? "",
      value = await advisoryBody(c.req.raw);
    if (
      Object.keys(value).some((k) => k !== "kind") ||
      (value.kind !== "paste" && value.kind !== "focus")
    )
      throw new ApplicationError("invalid_input", "Invalid interview event", 400);
    await deps.monitoring.report(actor, c.req.param("id"), key, value.kind as RuleKind);
    return c.json({});
  });
  return app;
}
