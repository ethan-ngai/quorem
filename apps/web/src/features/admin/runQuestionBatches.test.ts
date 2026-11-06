/** @file runQuestionBatches.test.ts @description Queue recovery and cancellation contracts. @module admin */
import { expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { runQuestionBatches } from "./runQuestionBatches";

const rows = Array.from({ length: 33 }, (_, id) => ({ id: String(id) }));
const succeeded = (batch: typeof rows) => ({
  items: batch.map(({ id }) => ({ id, status: "succeeded" })),
});
const expired = (id: string) => ({ id, status: "failed", code: "step_up_required" });
function setup() {
  return {
    rows,
    send: vi.fn(async (batch: typeof rows) => succeeded(batch)),
    verify: vi.fn(async () => {}),
    cancelled: () => false,
    onProgress: vi.fn(),
    onResults: vi.fn(),
  };
}
it("sends bounded batches and reports completed outcomes", async () => {
  const options = setup();
  await runQuestionBatches(options);
  expect(options.send.mock.calls.map(([batch]) => batch.length)).toEqual([16, 16, 1]);
  expect(options.onProgress).toHaveBeenLastCalledWith(33, false);
});
it("verifies once and retries only rejected items, never successful publications", async () => {
  const options = setup();
  options.send.mockResolvedValueOnce({
    items: [{ id: "0", status: "succeeded" }, ...rows.slice(1, 16).map(({ id }) => expired(id))],
  });
  await runQuestionBatches(options);
  expect(options.verify).toHaveBeenCalledTimes(1);
  expect(options.send.mock.calls[1]![0].map(({ id }) => id)).toEqual(
    rows.slice(1, 16).map(({ id }) => id),
  );
  expect(options.onResults.mock.calls.flatMap(([items]) => items)).toHaveLength(33);
});
it("recovers a request-wide verification rejection", async () => {
  const options = setup();
  options.send.mockRejectedValueOnce(new ApiError("Verify", "step_up_required"));
  await runQuestionBatches(options);
  expect(options.verify).toHaveBeenCalledTimes(1);
  expect(options.send.mock.calls[1]![0]).toEqual(rows.slice(0, 16));
});
it("stops unsent batches after cancellation while retaining the in-flight outcomes", async () => {
  const options = setup();
  let cancelled = false;
  options.cancelled = () => cancelled;
  options.send.mockImplementation(async (batch) => {
    cancelled = true;
    return succeeded(batch);
  });
  await runQuestionBatches(options);
  expect(options.send).toHaveBeenCalledTimes(1);
  expect(options.onResults.mock.calls[0]![0]).toHaveLength(16);
});
it("does not retry when cancelled during verification", async () => {
  const options = setup();
  let cancelled = false;
  options.cancelled = () => cancelled;
  options.send.mockRejectedValueOnce(new ApiError("Verify", "step_up_required"));
  options.verify.mockImplementation(async () => {
    cancelled = true;
  });
  await runQuestionBatches(options);
  expect(options.send).toHaveBeenCalledTimes(1);
});
it("fails fast on request errors and declined verification", async () => {
  for (const verification of [false, true]) {
    const options = setup();
    options.send.mockRejectedValueOnce(
      verification ? new ApiError("Verify", "step_up_required") : new Error("offline"),
    );
    options.verify.mockRejectedValue(new Error("cancelled"));
    await expect(runQuestionBatches(options)).rejects.toThrow(
      verification ? "cancelled" : "offline",
    );
    expect(options.send).toHaveBeenCalledTimes(1);
  }
});
it("bounds retries if verification still does not satisfy the server", async () => {
  const options = setup();
  options.send.mockImplementation(async (batch) => ({ items: batch.map(({ id }) => expired(id)) }));
  await expect(runQuestionBatches(options)).rejects.toThrow("Verification still required");
  expect(options.verify).toHaveBeenCalledTimes(1);
  expect(options.send).toHaveBeenCalledTimes(2);
});
it("stops a wholly failed batch and exposes its item errors", async () => {
  const options = setup();
  options.send.mockImplementation(async (batch) => ({
    items: batch.map(({ id }) => ({ id, status: "failed", code: "forbidden" })),
  }));
  await expect(runQuestionBatches(options)).rejects.toThrow("Batch failed");
  expect(options.send).toHaveBeenCalledTimes(1);
  expect(options.onResults.mock.calls[0]![0]).toHaveLength(16);
});
