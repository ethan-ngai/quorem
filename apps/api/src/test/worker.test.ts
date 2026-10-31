/** @file worker.test.ts @description Workerd HTTP contract. @module api */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";
import { health } from "../runtime/composition/health.ts";
import { contract } from "./contract.ts";
contract((path, init) => SELF.fetch(`http://localhost${path}`, init));

test("worker shell composes configured origins", async () => {
  const response = await health(
    new Request("https://api.test/health", { headers: { origin: "https://quorem.test" } }),
    ["https://quorem.test"],
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://quorem.test");
});
