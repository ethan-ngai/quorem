/** @file registration-limits.test.ts @description Registration abuse isolation. @module auth */
import { expect, test } from "vitest";
import { createRegistrationHandler } from "./registration.ts";
import type { MailRepository } from "./mail-repository.ts";
import type { MailIntentService } from "./mail-intent.ts";

test("limits each peer and endpoint independently before proof work", async () => {
  const counts = new Map<string, number>();
  let completed = 0,
    statusReads = 0;
  const repository = {
    async rateLimit(scope: string, subject: string, limit: number) {
      const key = `${scope}:${subject}`,
        count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: count <= limit, retryAfter: 60 };
    },
    async status() {
      statusReads++;
      return undefined;
    },
    async complete() {
      completed++;
      return "ok";
    },
  } as unknown as MailRepository;
  const handler = createRegistrationHandler({
    repository,
    mail: {} as MailIntentService,
    origin: "https://example.test",
  });
  const call = (path: string, peer: string, body: object) =>
    handler(
      new Request(`https://example.test/api/auth/registration/${path}`, {
        method: "POST",
        headers: { origin: "https://example.test", "x-quorem-peer-ip": peer },
        body: JSON.stringify(body),
      }),
    );
  for (const path of ["arbitrary", "nested/start", "nested/status", "status/extra"]) {
    expect((await call(path, "192.0.2.1", {}))?.status).toBe(404);
    expect(
      (await handler(new Request(`https://example.test/api/auth/registration/${path}`)))?.status,
    ).toBe(404);
  }
  expect(counts.size).toBe(0);
  expect(statusReads).toBe(0);
  expect(
    (await handler(new Request("https://example.test/api/auth/registration/status")))?.status,
  ).toBe(401);
  expect(statusReads).toBe(1);
  expect((await call("status", "192.0.2.1", {}))?.status).toBe(405);
  expect(counts.size).toBe(0);
  for (let n = 0; n < 60; n++) expect((await call("verify", "192.0.2.1", {}))?.status).toBe(400);
  expect((await call("verify", "192.0.2.1", {}))?.status).toBe(429);
  expect((await call("verify", "192.0.2.2", {}))?.status).toBe(400);
  expect(
    (
      await call("complete", "192.0.2.1", {
        email: "a@example.com",
        username: "someone",
        password: "Abc1234!",
        name: "Name",
      })
    )?.status,
  ).toBe(401);
  expect(completed).toBe(0);
});
