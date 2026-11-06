/** @file model.ts @description Read-only administrator overview port. @module admin */
import type { AdminOverview } from "@quorem/contracts";

export interface AdminOverviewReader {
  /** Recheck live account authority before reading platform aggregates. */
  overview(userId: string): Promise<AdminOverview>;
}
