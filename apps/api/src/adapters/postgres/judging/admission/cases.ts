import { caseStorageProjection } from "../../problems/storage.ts";
import { ApplicationError } from "../../../../application/error.ts";

/** The sidecar is only admitted when all deployed readers and writers support it. */
export function storeCases(
  raw: string,
  losslessEnabled: boolean,
): { json: string; lossless: Uint8Array | null } {
  let result: ReturnType<typeof caseStorageProjection>;
  try {
    result = caseStorageProjection(raw);
  } catch {
    throw new ApplicationError("invalid_input", "Invalid execution cases", 400);
  }
  if (result.lossless && !losslessEnabled)
    throw new ApplicationError(
      "invalid_input",
      "NUL or lossless numeric cases are temporarily unavailable",
      400,
    );
  return { json: result.safe, lossless: result.lossless };
}
