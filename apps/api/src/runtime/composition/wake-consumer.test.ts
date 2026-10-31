import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { consumeWakeBatch, type WakeMessage } from "./wake-consumer.ts";
it("persists early and incomplete continuations before acknowledgment and retries failures", async () => {
  let status = 200,
    payload = '{"queued":0,"running":0}',
    sends = 0,
    fail = false;
  const server = createServer((request, response) => {
    request.resume();
    request.once("end", () => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(payload);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/drain`;
  const events: string[] = [];
  const message = (body: unknown): WakeMessage => ({
    body,
    attempts: 2,
    ack: () => events.push("ack"),
    retry: () => events.push("retry"),
  });
  const publisher = {
    async send() {
      sends++;
      events.push("send");
      if (fail) throw new Error("offline");
    },
  };
  const options = {
    publisher,
    drainURL: url,
    credential: "fixture-drain-credential-32-characters",
    local: true,
  };
  try {
    await consumeWakeBatch(
      [
        message(
          JSON.stringify({
            jobId: "early",
            phase: "admission",
            admissionUntil: Date.now() + 10000,
          }),
        ),
      ],
      options,
    );
    expect(events).toEqual(["send", "ack"]);
    events.length = 0;
    status = 202;
    payload = '{"queued":1,"running":0}';
    fail = true;
    await consumeWakeBatch(
      [message(JSON.stringify({ jobId: "pending", phase: "continuation" }))],
      options,
    );
    expect(events).toEqual(["send", "retry"]);
    events.length = 0;
    status = 503;
    await consumeWakeBatch(
      [message(JSON.stringify({ jobId: "failed", phase: "continuation" })), message("not-json")],
      options,
    );
    expect(events).toEqual(["retry", "retry"]);
    events.length = 0;
    status = 200;
    payload = '{"queued":1,"running":0}';
    await consumeWakeBatch(
      [message(JSON.stringify({ jobId: "inconsistent", phase: "continuation" }))],
      options,
    );
    expect(events).toEqual(["retry"]);
    expect(sends).toBe(2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
