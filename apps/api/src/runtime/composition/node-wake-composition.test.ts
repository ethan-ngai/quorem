import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { SQSClient } from "@aws-sdk/client-sqs";
import { expect, it } from "vitest";
import { sqsQueue } from "../../adapters/delivery/sqs.ts";
import { startNodeRuntime } from "../node.ts";
import { assertRuntimeTestDatabase } from "./test-database.ts";
import { localSqsFixture } from "./fixtures/local-sqs.ts";
const url = process.env.QUOREM_RUNTIME_TEST_URL;
it.skipIf(!url)(
  "Node composition drains and acknowledges an actual SQS protocol wake",
  async () => {
    assertRuntimeTestDatabase(url!);
    const { server: queueServer, size, actions } = localSqsFixture();
    let drains = 0;
    const drain = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${"d".repeat(40)}`) return res.writeHead(401).end();
      drains++;
      res.writeHead(200, { "content-type": "application/json" }).end('{"queued":0,"running":0}');
    });
    queueServer.listen(0, "127.0.0.1");
    drain.listen(0, "127.0.0.1");
    await Promise.all([once(queueServer, "listening"), once(drain, "listening")]);
    const queuePort = (queueServer.address() as AddressInfo).port,
      drainPort = (drain.address() as AddressInfo).port;
    const prior = {
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    };
    Object.assign(process.env, {
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "fixture",
      AWS_SECRET_ACCESS_KEY: "fixture",
    });
    const publicKey = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
    let runtime: Awaited<ReturnType<typeof startNodeRuntime>> | undefined;
    try {
      runtime = await startNodeRuntime({
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://127.0.0.1:8765",
        AUTH_DATABASE_URL: url!,
        DATABASE_URL: url!,
        QUOREM_DATABASE_LISTEN_URL: url!,
        BETTER_AUTH_SECRET: "a".repeat(40),
        AUTH_INTERNAL_SECRET: "local-test-internal",
        QUOREM_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
        MATCH_INVITE_KEY: "ab".repeat(32),
        EXECUTION_WAKE_PROVIDER: "sqs",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/000000000000/test",
        SQS_LOCAL_ENDPOINT: `http://127.0.0.1:${queuePort}`,
        EXECUTION_DRAIN_URL: `http://127.0.0.1:${drainPort}/internal/drain`,
        EXECUTION_DRAIN_SECRET: "d".repeat(40),
        EXECUTION_DRAIN_ACCESS_MODE: "none",
        PORT: "0",
        IDENTITY_MODE: "managed",
        RUNNER_PEERS: JSON.stringify([
          { secret: "b".repeat(40), scope: "fixture", resumable: true },
        ]),
        VERIFICATION_SOURCE_CREDENTIAL: "1".repeat(64),
        VERIFICATION_SERVICE_CREDENTIAL: "2".repeat(64),
        VERIFICATION_ACCESS_MODE: "none",
        VERIFICATION_SERVICE_ORIGIN: "http://127.0.0.1:18761",
        VERIFICATION_PUBLIC_KEY: publicKey,
      });
      const client = new SQSClient({
        region: "us-east-1",
        credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
        endpoint: `http://127.0.0.1:${queuePort}`,
        useQueueUrlAsEndpoint: false,
      });
      try {
        await sqsQueue("https://sqs.us-east-1.amazonaws.com/000000000000/test", client).send({
          jobId: "fixture",
          phase: "admission",
          admissionUntil: Date.now() + 1000,
        });
      } finally {
        client.destroy();
      }
      for (let i = 0; i < 300 && (drains < 2 || size() !== 0); i++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(drains, JSON.stringify(actions())).toBeGreaterThanOrEqual(2);
      expect(size()).toBe(0);
    } finally {
      await runtime?.close();
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await Promise.all([
        new Promise<void>((resolve) => queueServer.close(() => resolve())),
        new Promise<void>((resolve) => drain.close(() => resolve())),
      ]);
    }
  },
);
