import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { remoteSandbox } from "../../../../runner/src/sandbox/remote.ts";
import {
  createRunnerCommandHandler,
  type RunnerPeer,
} from "../../adapters/postgres/judging/worker/http.ts";
import { localJudgingDrain } from "./judging-drain.ts";

it("authenticates a native drain and rejects a sandbox outside the peer scope", async () => {
  const config = {
    origin: "https://case.example.test",
    secret: "c".repeat(64),
    namespaceId: "a".repeat(64),
    ownerPublicKey: generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    }),
  };
  const peer = {
    secret: "d".repeat(64),
    scope: remoteSandbox({ ...config, cleanupMs: 30000 }).scope,
    resumable: true,
  };
  const claimAfterTeardown = vi.fn(async () => null);
  const repository = {
    claimAfterTeardown,
    nextExpiredAttempt: async () => null,
    queueState: async () => ({ queued: 0, running: 0 }),
    confirmQueueEmpty: async () => true,
    nextRunnableDeadline: async () => null,
    finalizeCompletion: vi.fn(),
  } as unknown as ReturnType<RunnerPeer["repository"]>;
  const handle = await createRunnerCommandHandler([
    {
      ...peer,
      inputProtocol: "manifest-v1",
      drain: localJudgingDrain(peer, async () => {}),
      repository: () => repository,
    },
  ]);
  const send = (secret: string, payload = config) =>
    handle(
      new Request("https://api.example.test/internal/runner/drain", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify(payload),
      }),
    );

  expect((await send(config.secret)).status).toBe(401);
  expect((await send(peer.secret, { ...config, namespaceId: "b".repeat(64) })).status).toBe(403);
  expect(claimAfterTeardown).not.toHaveBeenCalled();
  const drained = await send(peer.secret);
  expect(drained.status).toBe(200);
  expect(await drained.json()).toEqual({ queued: 0, running: 0 });
  expect(claimAfterTeardown).toHaveBeenCalledWith(true, peer.scope, null, expect.any(AbortSignal));
});
