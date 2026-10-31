/** @file verified-progress.ts @description Match progress authority for normalized runner inputs. @module judging */
import type { Transaction } from "@quorem/database/core";

export type VerifiedMatchProgress =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "verified";
      readonly caseCount: number;
      readonly definiteFailures: number;
      readonly terminal: null | { readonly verdict: string; readonly passed: number };
    };

/** No manifest outcome is authoritative until the independent comparator persists evidence. */
export async function verifiedMatchProgress(
  _tx: Transaction,
  _jobId: string,
): Promise<VerifiedMatchProgress> {
  return { kind: "unavailable" };
}
