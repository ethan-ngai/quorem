// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { DevelopmentIdentity } from "@quorem/contracts";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../auth/session", () => ({ authenticatedFetch: fetchMock }));
import { partyCommand } from "./party";

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});

it("replays the same key and payload after an uncertain response", async () => {
  fetchMock.mockRejectedValueOnce(new Error("connection lost"));
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const identity = "alice" as DevelopmentIdentity;
  await expect(
    partyCommand(identity, "/v1/parties", "POST", { difficulty: "easy" }),
  ).rejects.toThrow();
  await partyCommand(identity, "/v1/parties", "POST", { difficulty: "hard" });
  const first = fetchMock.mock.calls[0]![1] as RequestInit;
  const second = fetchMock.mock.calls[1]![1] as RequestInit;
  expect(first.body).toBe(JSON.stringify({ difficulty: "easy" }));
  expect(second.body).toBe(first.body);
  expect((second.headers as Record<string, string>)["Idempotency-Key"]).toBe(
    (first.headers as Record<string, string>)["Idempotency-Key"],
  );
});

it("releases a definitively rejected command for a corrected request", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const identity = "bob" as DevelopmentIdentity;
  await expect(
    partyCommand(identity, "/v1/parties", "POST", { difficulty: "easy" }),
  ).rejects.toThrow();
  await partyCommand(identity, "/v1/parties", "POST", { difficulty: "hard" });
  const first = fetchMock.mock.calls[0]![1] as RequestInit;
  const second = fetchMock.mock.calls[1]![1] as RequestInit;
  expect(second.body).toBe(JSON.stringify({ difficulty: "hard" }));
  expect((second.headers as Record<string, string>)["Idempotency-Key"]).not.toBe(
    (first.headers as Record<string, string>)["Idempotency-Key"],
  );
});
