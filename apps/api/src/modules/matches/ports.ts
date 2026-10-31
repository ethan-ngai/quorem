/** @file ports.ts @description Scheduling-facing match reconciliation contract. @module matches */
export interface MatchReconciler {
  reconcile(id: string, generation: string | null): Promise<void>;
}
