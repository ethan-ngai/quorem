/** @file runQuestionBatches.ts @description Cancellable batches with bounded verification recovery. @module admin */
import { ApiError } from "../../api/client";
import { UserFacingError } from "../../ui/errors";

type Item = { id: string; status: string; code?: string; message?: string };

/** @returns Completed outcomes; unsent items remain untouched after cancellation or failure. */
export async function runQuestionBatches<Row extends { id: string }, Result extends Item>({
  rows,
  send,
  verify,
  cancelled,
  onProgress,
  onResults,
}: {
  rows: readonly Row[];
  send: (rows: Row[]) => Promise<{ items: Result[] }>;
  verify: () => Promise<void>;
  cancelled: () => boolean;
  onProgress: (completed: number, verifying: boolean) => void;
  onResults: (items: Result[]) => void;
}) {
  let completed = 0;
  for (let offset = 0; offset < rows.length && !cancelled(); offset += 16) {
    let pending = rows.slice(offset, offset + 16);
    let verified = false;
    while (pending.length && !cancelled()) {
      onProgress(completed, false);
      let items: Result[];
      try {
        items = (await send(pending)).items;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "step_up_required" || verified)
          throw error;
        items = [];
      }
      const rejected = items.filter((item) => item.code === "step_up_required");
      const settled = items.filter((item) => item.code !== "step_up_required");
      onResults(settled);
      completed += settled.length;
      onProgress(completed, false);
      if (items.length && !rejected.length) {
        if (settled.every((item) => item.status !== "succeeded"))
          throw new UserFacingError(
            "Batch failed. Remaining questions were not sent. Review the errors before retrying.",
          );
        break;
      }
      if (items.length)
        pending = pending.filter((row) => rejected.some((item) => item.id === row.id));
      if (cancelled()) break;
      if (verified)
        throw new UserFacingError("Verification still required. Publication stopped. Try again.");
      onProgress(completed, true);
      await verify();
      verified = true;
    }
  }
}
