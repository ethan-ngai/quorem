import { describe, expect, it } from "vitest";
import { createApp } from "../../../app.ts";
import { admissionRoutes, type AdmissionDependencies } from "./routes.ts";

const who = {
  kind: "local" as const,
  userId: "fixture",
  displayName: "Fixture",
  admin: false,
  emailVerified: true,
  sessionId: "fixture",
  strongUntil: 0,
};
const workspaceId = "00000000-0000-4000-8000-000000000001";
function setup(overrides: Partial<AdmissionDependencies> = {}) {
  let commits = 0;
  const deps: AdmissionDependencies = {
    identify: async () => who,
    guestExecution: true,
    receipts: {
      create: async () => {},
      settle: async () => "pending",
      acknowledge: async () => {},
      list: async () => [],
    },
    coordinator: { prearm: async () => {}, wake: async () => {} },
    publisher: { send: async () => {} },
    shard: 0,
    commit: async (_who, _key, command) => {
      commits++;
      return {
        id: "fixture",
        state: "queued",
        sourceHash: command.sourceHash,
        admittedAt: "2026-01-01T00:00:00Z",
      };
    },
    ...overrides,
  };
  const app = createApp({ allowedOrigins: ["https://fixture.test"], requestId: () => "req" });
  app.route("/", admissionRoutes(deps));
  const call = (body: unknown, key = "key") =>
    app.request("https://fixture.test/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
  return { call, commits: () => commits };
}
describe("submission admission transport", () => {
  it("derives hashes server-side and rejects untrusted context", async () => {
    const f = setup(),
      valid = { workspaceId, kind: "run", source: "x" };
    const response = await f.call(valid);
    expect(response.status).toBe(202);
    expect((await response.json()).sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await f.call({ ...valid, sourceHash: "forged" })).status).toBe(400);
    expect((await f.call({ ...valid, source: "a\u0000b" })).status).toBe(400);
    expect(f.commits()).toBe(1);
  });
  it("never commits when required wake fails", async () => {
    const f = setup({
      publisher: {
        send: async () => {
          throw new Error("offline");
        },
      },
    });
    expect((await f.call({ workspaceId, kind: "run", source: "x" })).status).toBe(503);
    expect(f.commits()).toBe(0);
  });
});
