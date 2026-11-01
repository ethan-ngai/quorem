import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { withWorkerConnection } from "@quorem/database/core";
import { sql } from "drizzle-orm";
describe("workerd PostgreSQL dispatch", () => {
  it("claims and acknowledges a committed notice", async () => {
    const url = (env as unknown as { DISPATCH_DATABASE_URL: string }).DISPATCH_DATABASE_URL;
    const parsed = new URL(url);
    expect(parsed.port).toBe("55452");
    expect(parsed.pathname).toBe("/quorem_hono_dispatch_test");
    await withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 5000 }, (scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`INSERT INTO membership_outbox(id,participant_id) VALUES (${crypto.randomUUID()}::uuid,${crypto.randomUUID()}::uuid)`,
        );
      }),
    );
    const response = await SELF.fetch("https://worker/");
    expect(await response.json()).toEqual({ claimed: true, ack: true });
  });
});

it("persists continuation before acknowledging an early wake in workerd", async () => {
  const { cloudflareBinding } = await import("../../delivery/cloudflare.ts");
  const { consumeWake } = await import("../../../modules/events/dispatch/dispatch.ts");
  const sent: string[] = [];
  const publisher = cloudflareBinding({
    send: async (body) => {
      sent.push(body);
    },
  });
  await consumeWake(
    { jobId: "job-1", phase: "admission", admissionUntil: Date.now() + 5000 },
    publisher,
    async () => ({ pending: false }),
  );
  expect(JSON.parse(sent[0]!).phase).toBe("continuation");
});
