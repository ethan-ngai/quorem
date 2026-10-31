/** @file model.ts @description Interview monitoring commands. @module interviews */
import type { Principal } from "../../identity/model.ts";
export type MonitoringPolicy = { paste?: boolean | null; focus?: boolean | null };
export type RuleKind = "paste" | "focus";
export interface InterviewMonitoring {
  setPolicy(actor: Principal, id: string, key: string, policy: MonitoringPolicy): Promise<string>;
  report(actor: Principal, id: string, key: string, kind: RuleKind): Promise<void>;
}
