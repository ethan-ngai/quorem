import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { composeHttp, type HttpPorts } from "./http.ts";
import { socketTarget } from "../worker/socket/target.ts";
const unavailable = async (): Promise<never> => {
  throw new Error("Inventory must not perform I/O");
};
const ports: HttpPorts = {
  run: unavailable,
  identify: unavailable,
  managed: unavailable,
  guests: { lookup: unavailable, endMatch: unavailable },
  origins: [],
  trustedPeer: () => undefined,
  deadline: { prearm: unavailable, wake: unavailable },
  execution: { prearm: unavailable, wake: unavailable },
  wake: { send: unavailable },
  inviteKey: new Uint8Array(32),
  shards: 1,
  guestAdmission: false,
  guestExecution: false,
  localStrongBypass: false,
};
const normalize = (path: string) => path.replace(/\{[^/}]+\}|:[^/]+/g, ":parameter");
const example = (path: string) =>
  path.replace(/\{[^/}]+\}/g, "12345678-1234-1234-1234-123456789abc");
it("registers the full HTTP inventory in the domain app or native socket classifier", () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../docs/plans/hono-workers-migration/execution/inventory.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { http: { method: string; path: string }[] };
  const registered = new Set(
    composeHttp(ports).app.routes.map((route) => `${route.method} ${normalize(route.path)}`),
  );
  const missing = inventory.http.filter(
    (item) =>
      !registered.has(`${item.method} ${normalize(item.path)}`) &&
      !(
        item.method === "GET" &&
        socketTarget(example(item.path))?.mode !== undefined &&
        socketTarget(example(item.path))?.mode !== "invalid"
      ),
  );
  expect(missing).toEqual([]);
  expect(inventory.http).toHaveLength(66);
});
it("classifies only supported browser socket routes", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  expect(socketTarget(`/v1/interviews/${id}/events`)).toEqual({
    stream: "interview",
    mode: "direct",
    id,
  });
  expect(socketTarget(`/v1/matches/${id}/events`)).toEqual({ stream: "match", mode: "direct", id });
  expect(socketTarget(`/v1/match-invites/token/events`)).toEqual({
    stream: "match",
    mode: "invite",
  });
  expect(socketTarget(`/v1/submissions/${id}/events`)).toEqual({
    stream: "submission",
    mode: "direct",
    id,
  });
  expect(socketTarget("/v1/memberships/events")).toEqual({
    stream: "membership",
    mode: "membership",
  });
  expect(socketTarget("/v1/matches/not-a-uuid/events")?.mode).toBe("invalid");
  expect(socketTarget("/v1/problems/events")).toBeUndefined();
});
