/** @file submissionRecovery.test.ts @description Initial submission recovery preserves authorization errors. @module editor */
import { expect, it, vi } from "vitest";
import { fetchSubmission, SubmissionReadError } from "./api";

const get = vi.fn();
vi.mock("../../api/client", () => ({ api: () => ({ GET: get }), requireData: vi.fn() }));

it("returns the authoritative snapshot and passes cancellation to the request", async () => {
  const snapshot = { id: "job", state: "completed" };
  get.mockResolvedValueOnce({ data: snapshot, response: { status: 200 } });
  const controller = new AbortController();
  expect(await fetchSubmission("alice", "job", controller.signal)).toBe(snapshot);
  expect(get).toHaveBeenLastCalledWith("/v1/submissions/{id}", {
    params: { path: { id: "job" } },
    signal: controller.signal,
  });
});

it.each([401, 403, 404, 503])("retains HTTP %i for recovery decisions", async (status) => {
  get.mockResolvedValueOnce({ data: undefined, response: { status } });
  const error = await fetchSubmission("alice", "job").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(SubmissionReadError);
  expect((error as SubmissionReadError).status).toBe(status);
});
