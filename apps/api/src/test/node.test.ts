/** @file node.test.ts @description Node HTTP contract. @module api */
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { failureSummary } from "../application/error.ts";
import { fixture } from "./fixture.ts";
import { contract } from "./contract.ts";
const server = serve({ fetch: fixture().fetch, hostname: "127.0.0.1", port: 0 });
let port = 0;
beforeAll(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP listener unavailable");
  port = address.port;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
contract((path, init) => fetch(`http://127.0.0.1:${port}${path}`, init));

it("failure diagnostics retain bounded causes without private provider details", () => {
  const cause = Object.assign(new Error("private query and parameters"), {
    code: "55P03",
    detail: "private row",
  });
  const error = new Error("private request\n    at privateStackValue", { cause });
  Object.defineProperty(cause, "cause", { value: error });
  const summary = failureSummary(error);
  expect(summary.causes).toHaveLength(2);
  expect(summary.causes[1].code).toBe("55P03");
  expect(JSON.stringify(summary)).not.toContain("private");
});
