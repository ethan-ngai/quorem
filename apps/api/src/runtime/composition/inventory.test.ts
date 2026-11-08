import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { composeHttp, type HttpPorts } from "./http.ts";
import { socketTarget } from "../worker/socket/target.ts";
const unavailable = async (): Promise<never> => {
  throw new Error("Inventory must not perform I/O");
};
const ports: HttpPorts = {
  run: unavailable,
  submissionNotices: { subscribe: unavailable },
  identify: unavailable,
  managed: unavailable,
  guests: { lookup: unavailable, endMatch: unavailable, canBootstrap: unavailable },
  origins: [],
  trustedPeer: () => undefined,
  deadline: { prearm: unavailable, wake: unavailable },
  execution: { prearm: unavailable, wake: unavailable },
  wake: { send: unavailable },
  inviteKey: new Uint8Array(32),
  shards: 1,
  guestCreation: false,
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
  const recorded = new Set(inventory.http.map((item) => `${item.method} ${normalize(item.path)}`));
  expect(recorded.size).toBe(inventory.http.length);
  expect(
    [...registered].filter((route) => !route.startsWith("ALL ") && !recorded.has(route)),
  ).toEqual([]);
});
it("classifies only supported browser socket routes", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  expect(socketTarget(`/v1/interviews/${id}/events`)).toEqual({
    stream: "interview",
    mode: "direct",
    id,
  });
  expect(socketTarget(`/v1/matches/${id}/events`)).toEqual({ stream: "match", mode: "direct", id });
  expect(socketTarget(`/v1/match-invites/token/events`)).toBeUndefined();
  expect(socketTarget(`/v1/submissions/${id}/events`)).toBeUndefined();
  expect(socketTarget("/v1/memberships/events")).toBeUndefined();
  expect(socketTarget("/v1/matches/not-a-uuid/events")?.mode).toBe("invalid");
  expect(socketTarget("/v1/problems/events")).toBeUndefined();
});
