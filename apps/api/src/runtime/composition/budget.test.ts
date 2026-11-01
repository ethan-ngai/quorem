import { expect, it } from "vitest";
import { requestBudget } from "./budget.ts";

it("holds the permit through streaming EOF and cancellation", async () => {
  const budget = requestBudget(1),
    request = new Request("https://example.test/");
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      closed = true;
    },
  });
  const first = await budget(request, async () => new Response(stream));
  const blocked = await budget(request, async () => new Response("unexpected"));
  expect(blocked.status).toBe(503);
  expect(blocked.headers.get("x-request-id")).toBeTruthy();
  await first.body!.cancel();
  expect(closed).toBe(true);
  const next = await budget(request, async () => new Response("ok"));
  expect(await next.text()).toBe("ok");
  expect((await budget(request, async () => new Response(null))).status).toBe(200);
});
it("releases a stream permit when its request aborts", async () => {
  const budget = requestBudget(1),
    abort = new AbortController();
  let cancelled = false;
  const request = new Request("https://example.test/", { signal: abort.signal });
  await budget(
    request,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  abort.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelled).toBe(true);
  expect(
    (await budget(new Request("https://example.test/"), async () => new Response(null))).status,
  ).toBe(200);
});
it("closes the downstream on abort and holds the permit until cancellation settles", async () => {
  const budget = requestBudget(1),
    abort = new AbortController();
  let settle!: () => void,
    calls = 0;
  const cancelled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const response = await budget(
    new Request("https://example.test/", { signal: abort.signal }),
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            calls++;
            return cancelled;
          },
        }),
      ),
  );
  const reader = response.body!.getReader();
  const pending = reader.read();
  abort.abort();
  expect(await pending).toEqual({ done: true, value: undefined });
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  await reader.cancel();
  expect(calls).toBe(1);
  expect(
    (await budget(new Request("https://example.test/"), async () => new Response(null))).status,
  ).toBe(503);
  settle();
  await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    (await budget(new Request("https://example.test/"), async () => new Response(null))).status,
  ).toBe(200);
});
it("handles an already aborted request and a rejected upstream cancellation", async () => {
  const budget = requestBudget(1),
    abort = new AbortController();
  abort.abort();
  const response = await budget(
    new Request("https://example.test/", { signal: abort.signal }),
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return Promise.reject(new Error("cancel failed"));
          },
        }),
      ),
  );
  expect(await response.text()).toBe("");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    (await budget(new Request("https://example.test/"), async () => new Response(null))).status,
  ).toBe(200);
});
it("preserves multiple Set-Cookie headers on streamed responses", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "a=1; Path=/; HttpOnly");
  headers.append("set-cookie", "b=2; Path=/; HttpOnly");
  const response = await requestBudget(1)(
    new Request("https://example.test/"),
    async () => new Response("ok", { headers }),
  );
  expect(response.headers.getSetCookie()).toHaveLength(2);
  await response.text();
});
