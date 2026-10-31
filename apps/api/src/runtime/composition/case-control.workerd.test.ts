/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

it("fences generations and retains registrations across native eviction", async () => {
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
  const activate = {
    operation: crypto.randomUUID(),
    release: genesis.release,
    bindings: "d".repeat(64),
    expectedGeneration: 0,
  };
  const registration = { attempt: "race", generation: 1, release: genesis.release };
  const pause = { operation: crypto.randomUUID(), expectedGeneration: 1 };
  expect((await post("/initialize", genesis)).status).toBe(204);
  expect((await post("/activate", activate)).status).toBe(204);
  const outcomes = await Promise.all([post("/register", registration), post("/pause", pause)]);
  expect([204, 503]).toContain(outcomes[0].status);
  expect(outcomes[1].status).toBe(204);
  await evictDurableObject(control);
  const stored = await runInDurableObject(control, (_instance, state) =>
    state.storage.get("attempt:race"),
  );
  expect(stored !== undefined).toBe(outcomes[0].status === 204);
  expect((await post("/register", registration)).status).toBe(503);
  expect((await post("/activate", activate)).status).toBe(204);
  expect((await post("/register", registration)).status).toBe(503);
  const activate2 = {
    operation: crypto.randomUUID(),
    release: "e".repeat(40),
    bindings: "f".repeat(64),
    expectedGeneration: 1,
  };
  expect((await post("/activate", activate2)).status).toBe(204);
  expect((await post("/register", registration)).status).toBe(503);
  expect(
    (await post("/register", { attempt: "new", generation: 2, release: activate2.release })).status,
  ).toBe(204);
  expect((await post("/initialize", { ...genesis, release: "d".repeat(40) })).status).toBe(409);
});
