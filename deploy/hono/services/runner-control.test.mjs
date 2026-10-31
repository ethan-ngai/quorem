import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RunnerReleaseControl } from "./runner-control.js";

function storage() {
  const values = new Map();
  let tail = Promise.resolve();
  const api = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    list: async ({ prefix, startAfter, limit }) =>
      new Map(
        [...values]
          .filter(([key]) => key.startsWith(prefix) && key > startAfter)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit),
      ),
  };
  return {
    ...api,
    transaction: async (fn) => {
      const result = tail.then(() => fn(api));
      tail = result.catch(() => {});
      return result;
    },
  };
}
const sha = "a".repeat(40),
  bindings = "b".repeat(64);
const request = (path, body) =>
  new Request(
    `https://runner-control.internal${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
void test("release gate freezes, fences, replays and survives recreation", async () => {
  const state = storage(),
    control = () => new RunnerReleaseControl({ storage: state }, {}),
    op = randomUUID();
  assert.equal(
    (await control().fetch(request("/gate", { generation: 0, release: sha }))).status,
    409,
  );
  const input = { operationId: op, expectedGeneration: 0, release: sha, bindings };
  const prepared = await (await control().fetch(request("/prepare", input))).json();
  assert.equal(prepared.generation, 1);
  assert.deepEqual(await (await control().fetch(request("/prepare", input))).json(), prepared);
  assert.equal(
    (await control().fetch(request("/prepare", { ...input, release: "c".repeat(40) }))).status,
    409,
  );
  assert.equal(
    (
      await control().fetch(
        request("/activate", {
          operationId: randomUUID(),
          generation: 1,
          release: sha,
          bindings: "d".repeat(64),
          token: prepared.token,
        }),
      )
    ).status,
    409,
  );
  const activate = {
    operationId: randomUUID(),
    generation: 1,
    release: sha,
    bindings,
    token: prepared.token,
  };
  assert.equal((await control().fetch(request("/activate", activate))).status, 200);
  assert.deepEqual(
    await (await control().fetch(request("/gate", { generation: 1, release: sha }))).json(),
    { generation: 1, release: sha, bindings, runner: `runner:${sha}:1` },
  );
  assert.equal(
    (await control().fetch(request("/pause", { operationId: randomUUID(), generation: 1 }))).status,
    200,
  );
  assert.equal(
    (await control().fetch(request("/gate", { generation: 1, release: sha }))).status,
    409,
  );
  assert.equal((await control().fetch(request("/activate", activate))).status, 200);
  assert.equal(
    (await control().fetch(request("/gate", { generation: 1, release: sha }))).status,
    409,
  );
  const history = await (await control().fetch(request("/history?limit=1"))).json();
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].release, sha);
});
void test("competing prepare operations cannot both win the same generation", async () => {
  const control = new RunnerReleaseControl({ storage: storage() }, {});
  const send = () =>
    control.fetch(
      request("/prepare", {
        operationId: randomUUID(),
        expectedGeneration: 0,
        release: sha,
        bindings,
      }),
    );
  assert.deepEqual(
    (await Promise.all([send(), send()])).map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
  assert.equal(
    (
      await control.fetch(
        request("/prepare", {
          operationId: randomUUID(),
          expectedGeneration: 1,
          release: sha,
          bindings,
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await control.fetch(request("/pause", { operationId: randomUUID(), generation: 1 }))).status,
    200,
  );
  assert.equal(
    (
      await control.fetch(
        request("/prepare", {
          operationId: randomUUID(),
          expectedGeneration: 1,
          release: sha,
          bindings,
        }),
      )
    ).status,
    200,
  );
  assert.equal((await control.fetch(request("/history?limit=65"))).status, 400);
  assert.equal(
    (
      await control.fetch(
        new Request("https://runner-control.internal/prepare", {
          method: "POST",
          body: "x".repeat(4097),
        }),
      )
    ).status,
    400,
  );
});

void test("new preparation freezes routing and immutable history uses bounded keyset pages", async () => {
  const control = new RunnerReleaseControl({ storage: storage() }, {});
  const first = await (
    await control.fetch(
      request("/prepare", {
        operationId: randomUUID(),
        expectedGeneration: 0,
        release: sha,
        bindings,
      }),
    )
  ).json();
  await control.fetch(
    request("/activate", {
      operationId: randomUUID(),
      generation: 1,
      release: sha,
      bindings,
      token: first.token,
    }),
  );
  const nextRelease = "c".repeat(40);
  const second = await (
    await control.fetch(
      request("/prepare", {
        operationId: randomUUID(),
        expectedGeneration: 1,
        release: nextRelease,
        bindings,
      }),
    )
  ).json();
  assert.equal(second.generation, 2);
  assert.equal(
    (await control.fetch(request("/gate", { generation: 1, release: sha }))).status,
    409,
  );
  const rejected = { operationId: randomUUID(), generation: 3 };
  assert.equal((await control.fetch(request("/pause", rejected))).status, 409);
  for (let n = 2; n < 66; n++) {
    assert.equal(
      (await control.fetch(request("/pause", { operationId: randomUUID(), generation: n }))).status,
      200,
    );
    assert.equal(
      (
        await control.fetch(
          request("/prepare", {
            operationId: randomUUID(),
            expectedGeneration: n,
            release: sha,
            bindings,
          }),
        )
      ).status,
      200,
    );
  }
  assert.equal((await control.fetch(request("/pause", rejected))).status, 409);
  assert.equal(
    (await control.fetch(request("/pause", { ...rejected, generation: 66 }))).status,
    409,
  );
  const page1 = await (await control.fetch(request("/history?limit=64"))).json();
  const page2 = await (await control.fetch(request("/history?after=64&limit=64"))).json();
  assert.equal(page1.items.length, 64);
  assert.deepEqual(
    page2.items.map((item) => item.generation),
    [65, 66],
  );
});
