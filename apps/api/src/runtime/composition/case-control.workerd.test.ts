/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

it("persists registrations and permanent pause across native eviction", async () => {
  const bindings = env as unknown as {
    CONTROL: { getByName(name: string): Parameters<typeof evictDurableObject>[0] };
    CASES: { idFromName(name: string): { toString(): string } };
  };
  const control = bindings.CONTROL.getByName(crypto.randomUUID());
  const namespace = bindings.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
  const genesis = {
    namespace,
    scope: `remote:${"b".repeat(64)}`,
    operation: crypto.randomUUID(),
    release: "c".repeat(40),
  };
  const post = (path: string, body: unknown) =>
    control.fetch(`https://private${path}`, { method: "POST", body: JSON.stringify(body) });
  expect((await post("/initialize", genesis)).status).toBe(204);
  expect((await post("/activate", genesis)).status).toBe(204);
  const outcomes = await Promise.all([
    post("/register", { attempt: "race" }),
    post("/pause", genesis),
  ]);
  expect([204, 503]).toContain(outcomes[0].status);
  expect(outcomes[1].status).toBe(204);
  await evictDurableObject(control);
  const stored = await runInDurableObject(control, (_instance, state) =>
    state.storage.get("attempt:race"),
  );
  expect(stored === true).toBe(outcomes[0].status === 204);
  expect((await post("/register", { attempt: "race" })).status).toBe(503);
  expect((await post("/activate", genesis)).status).toBe(409);
  expect((await post("/initialize", { ...genesis, release: "d".repeat(40) })).status).toBe(409);
});
