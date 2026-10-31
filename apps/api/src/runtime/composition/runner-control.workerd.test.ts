/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

it("persists release authority across eviction and serializes racing operations", async () => {
  const ns = (
    env as unknown as {
      RELEASE_CONTROL: {
        idFromName(name: string): unknown;
        get(id: unknown): Parameters<typeof runInDurableObject>[0];
      };
    }
  ).RELEASE_CONTROL;
  const id = ns.idFromName(crypto.randomUUID());
  let stub = ns.get(id);
  const sha = "a".repeat(40),
    bindings = "b".repeat(64);
  const send = (path: string, body: object): Promise<Response> =>
    stub.fetch(`https://runner-control.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as Promise<Response>;
  expect((await send("/gate", { generation: 0, release: sha })).status).toBe(409);
  const prepare = () =>
    send("/prepare", {
      operationId: crypto.randomUUID(),
      expectedGeneration: 0,
      release: sha,
      bindings,
    });
  const raced = await Promise.all([prepare(), prepare()]);
  expect(raced.map((x) => x.status).sort((a, b) => a - b)).toEqual([200, 409]);
  const receipt = (await raced.find((x) => x.status === 200)!.json()) as { token: string };
  const activate = {
    operationId: crypto.randomUUID(),
    generation: 1,
    release: sha,
    bindings,
    token: receipt.token,
  };
  expect((await send("/activate", activate)).status).toBe(200);
  expect((await send("/gate", { generation: 1, release: sha })).status).toBe(200);
  expect((await send("/pause", { operationId: crypto.randomUUID(), generation: 1 })).status).toBe(
    200,
  );
  try {
    await runInDurableObject(stub, (_instance, state) => state.abort("evict"));
  } catch {}
  stub = ns.get(id);
  expect((await send("/gate", { generation: 1, release: sha })).status).toBe(409);
  const state = (await (await stub.fetch("https://runner-control.internal/state")).json()) as {
    generation: number;
    status: string;
  };
  expect(state).toMatchObject({ generation: 1, status: "paused" });
  expect((await send("/activate", activate)).status).toBe(200);
  expect((await send("/gate", { generation: 1, release: sha })).status).toBe(409);
});
