/** @file fanout.test.ts @description Local provider and PostgreSQL wire conformance. @module events */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { WebSocketServer } from "ws";
import { frameText, wireNotice } from "../../../adapters/events/fanout/common.ts";
import { PostgresFanout } from "../../../adapters/events/fanout/postgres.ts";
import { AppSyncFanout } from "../../../adapters/events/fanout/appsync.ts";
import { noticePublisher } from "../../../adapters/events/fanout/publisher.ts";
import { CloudflareFanout } from "../../../adapters/events/fanout/cloudflare.ts";
const db = process.env.QUOREM_NODE_SOCKET_TEST_DATABASE_URL;
if (
  !db ||
  new URL(db).port !== "55472" ||
  new URL(db).pathname !== "/quorem_hono_node_socket_test" ||
  !["localhost", "127.0.0.1"].includes(new URL(db).hostname)
)
  throw new Error("Disposable socket database required");
const channel = `/matches/${crypto.randomUUID()}`;
const notice = {
  id: crypto.randomUUID(),
  aggregateId: channel.slice(9),
  version: "3",
  type: "match.updated",
  occurredAt: "2026-10-31T00:00:00.000Z",
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
void test("two PostgreSQL instances deliver redacted notices and close subscriptions", async () => {
  const a = new PostgresFanout(db, db),
    b = new PostgresFanout(db, db);
  await Promise.all([a.start(), b.start()]);
  try {
    let got: unknown,
      lost = 0;
    const stop = await b.subscribe(
      channel,
      (n) => {
        got = n;
      },
      () => lost++,
    );
    assert.equal(
      wireNotice(channel, { ...notice, occurredAt: "2026-10-31 00:00:00+00" }).OccurredAt,
      "2026-10-31T00:00:00.000Z",
    );
    const privateNotice = { ...notice, secret: "PRIVATE" };
    await a.publish(channel, privateNotice);
    for (let i = 0; i < 40 && !got; i++) await delay(10);
    assert.deepEqual(got, notice);
    assert.equal(JSON.stringify(got).includes("PRIVATE"), false);
    await b.close();
    assert.equal(lost, 1);
    stop();
    await assert.rejects(
      b.subscribe(
        channel,
        () => {},
        () => {},
      ),
    );
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
void test("AppSync IAM canonical body signature and API-key relay protocol", async () => {
  let mode: "ok" | "failed" | "oversized" | "redirect" = "ok",
    seen = "",
    requests = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    seen = Buffer.concat(chunks).toString();
    assert.equal(req.headers["x-api-key"], "fixture-key");
    assert.equal(req.headers["content-type"], "application/json");
    requests++;
    if (mode === "redirect") {
      res.writeHead(302, { location: "/leak" }).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      mode === "oversized"
        ? "x".repeat(65537)
        : mode === "failed"
          ? '{"successful":[],"failed":[{}]}'
          : '{"successful":[{}],"failed":[]}',
    );
  });
  const wss = new WebSocketServer({
    server,
    handleProtocols: (p) => (p.has("aws-appsync-event-ws") ? "aws-appsync-event-ws" : false),
  });
  wss.on("connection", (ws, req) => {
    const auth = (req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .find((x) => x.startsWith("header-"))!;
    assert.equal(
      JSON.parse(Buffer.from(auth.slice(7), "base64url").toString())["x-api-key"],
      "fixture-key",
    );
    ws.on("message", (data) => {
      const msg = JSON.parse(frameText(data));
      if (msg.type === "connection_init")
        ws.send(JSON.stringify({ type: "connection_ack", connectionTimeoutMs: 3000 }));
      if (msg.type === "subscribe") {
        assert.equal(msg.channel, channel);
        assert.equal(msg.authorization["x-api-key"], "fixture-key");
        ws.send(JSON.stringify({ type: "subscribe_success", id: "quorem" }));
        ws.send(
          JSON.stringify({
            type: "data",
            id: "quorem",
            event: [
              JSON.stringify({
                ID: notice.id,
                AggregateID: notice.aggregateId,
                Version: notice.version,
                Type: notice.type,
                OccurredAt: notice.occurredAt,
                Secret: "PRIVATE",
              }),
            ],
          }),
        );
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/event`;
  const client = new AppSyncFanout(base, base.replace("http:", "ws:"), { apiKey: "fixture-key" });
  const signal = new AbortController();
  try {
    await client.publish(channel, notice);
    const body = JSON.parse(seen);
    assert.equal(body.channel, channel);
    assert.equal(JSON.parse(body.events[0]).AggregateID, notice.aggregateId);
    mode = "failed";
    await assert.rejects(client.publish(channel, notice));
    mode = "oversized";
    await assert.rejects(client.publish(channel, notice));
    mode = "redirect";
    await assert.rejects(client.publish(channel, notice));
    assert.equal(requests, 4);
    mode = "ok";
    let actual: unknown;
    const stop = await client.subscribe(
      channel,
      (n) => {
        actual = n;
      },
      () => {},
      signal.signal,
    );
    for (let i = 0; i < 20 && !actual; i++) await delay(10);
    assert.deepEqual(actual, notice);
    stop();
    const iam = new AppSyncFanout(
      "https://example.appsync-api.us-east-1.amazonaws.com/event",
      "wss://example.appsync-realtime-api.us-east-1.amazonaws.com/event/realtime",
      {
        region: "us-east-1",
        credentials: async () => ({
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: "test-secret",
          sessionToken: "test-session",
        }),
      },
    );
    const bodyText = '{"channel":"/matches/example"}';
    const headers = await iam.authorization(bodyText, new Date("2026-01-02T03:04:05Z"));
    assert.equal(headers.host, "example.appsync-api.us-east-1.amazonaws.com");
    assert.equal(headers["x-amz-date"], "20260102T030405Z");
    assert.equal(headers["x-amz-security-token"], "test-session");
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const signed = headers.authorization.match(/SignedHeaders=([^,]+), Signature=([a-f0-9]+)/)!;
    const names = signed[1].split(";");
    const canonicalHeaders = names
      .map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`)
      .join("");
    const canonical = ["POST", "/event", "", canonicalHeaders, signed[1], sha(bodyText)].join("\n");
    const scope = "20260102/us-east-1/appsync/aws4_request";
    const text = ["AWS4-HMAC-SHA256", "20260102T030405Z", scope, sha(canonical)].join("\n");
    const hmac = (key: Buffer | string, value: string) =>
      createHmac("sha256", key).update(value).digest();
    const k = hmac(
      hmac(hmac(hmac("AWS4test-secret", "20260102"), "us-east-1"), "appsync"),
      "aws4_request",
    );
    assert.equal(signed[2], createHmac("sha256", k).update(text).digest("hex"));
  } finally {
    signal.abort();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
void test("Cloudflare private relay requires credential and maps notices", async () => {
  const token = "z".repeat(32);
  let posts = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    for await (const _ of req) {
    }
    posts++;
    res.writeHead(204).end();
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    ws.send(
      JSON.stringify({
        ID: notice.id,
        AggregateID: notice.aggregateId,
        Version: notice.version,
        Type: notice.type,
        OccurredAt: notice.occurredAt,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new CloudflareFanout(`http://127.0.0.1:${address.port}`, token),
    ctrl = new AbortController();
  try {
    await client.publish(channel, notice);
    assert.equal(posts, 1);
    let value: unknown,
      lost = 0;
    const stop = await client.subscribe(
      channel,
      (n) => {
        value = n;
      },
      () => {
        lost++;
      },
      ctrl.signal,
    );
    for (let i = 0; i < 20 && !value; i++) await delay(10);
    assert.deepEqual(value, notice);
    for (const ws of wss.clients)
      ws.send(JSON.stringify({ ...notice, aggregateId: crypto.randomUUID() }));
    for (let i = 0; i < 20 && !lost; i++) await delay(10);
    assert.equal(lost, 1);
    stop();
  } finally {
    ctrl.abort();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

void test("match dispatch publishes both channels and propagates partial failures", async () => {
  const topics: string[] = [];
  const publisher = noticePublisher({
    publish: async (topic, value) => {
      topics.push(topic);
      assert.deepEqual(value, notice);
      if (topic.startsWith("/match-invites/")) throw new Error("offline");
    },
  });
  await assert.rejects(publisher.publish("match", notice));
  assert.deepEqual(topics, [
    `/matches/${notice.aggregateId}`,
    `/match-invites/${notice.aggregateId}`,
  ]);
});
