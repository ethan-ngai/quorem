/** @file submissionRecovery.test.ts @description Initial submission recovery preserves authorization errors. @module editor */
import { expect, it, vi } from "vitest";
import { fetchSubmission, SubmissionReadError } from "./api";
import { forgetMissingSubmission } from "./submissionRecovery";

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

it("clears only the same saved ID after an authoritative 404", () => {
  const storage = { getItem: vi.fn(() => "job"), removeItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  try {
    expect(forgetMissingSubmission(new SubmissionReadError(401), "saved", "job")).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(forgetMissingSubmission(new SubmissionReadError(404), "saved", "other")).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(forgetMissingSubmission(new SubmissionReadError(404), "saved", "job")).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith("saved");
    storage.getItem.mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(forgetMissingSubmission(new SubmissionReadError(404), "saved", "job")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
