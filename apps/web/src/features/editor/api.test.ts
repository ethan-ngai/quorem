/** @file api.test.ts @description Cancellation recovery when judging finishes first. @module editor */
import { expect, it, vi } from "vitest";
import { cancelSubmission } from "./api";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", async (original) => ({
  ...(await original<typeof import("../../api/client")>()),
  api: () => ({ GET: get, POST: post }),
}));

it("returns the finished result when cancellation races with completion", async () => {
  post.mockResolvedValue({
    response: { status: 409 },
    error: { error: { code: "invalid_transition", message: "Execution already finished" } },
  });
  const result = { id: "execution", state: "completed" };
  get.mockResolvedValue({ response: { status: 200 }, data: result });

  await expect(cancelSubmission("alice", result.id)).resolves.toEqual(result);
  expect(get).toHaveBeenCalledWith(
    "/v1/submissions/{id}",
    expect.objectContaining({ params: { path: { id: result.id } } }),
  );
});

it("surfaces an unauthorized cancellation", async () => {
  get.mockClear();
  post.mockResolvedValue({
    response: { status: 404 },
    error: { error: { code: "not_found", message: "Submission not found" } },
  });

  await expect(cancelSubmission("alice", "match-submit")).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
