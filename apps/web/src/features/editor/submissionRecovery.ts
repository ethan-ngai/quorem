/** @file submissionRecovery.ts @description Forget only authoritatively missing saved submissions. @module editor */
import { SubmissionReadError } from "./api";

export function forgetMissingSubmission(cause: unknown, key: string, id: string): boolean {
  if (!(cause instanceof SubmissionReadError) || cause.status !== 404) return false;
  try {
    if (localStorage.getItem(key) === id) localStorage.removeItem(key);
  } catch {
    /* Recovery can proceed without browser storage. */
  }
  return true;
}
