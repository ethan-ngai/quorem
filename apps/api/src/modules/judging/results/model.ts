/** @file model.ts @description Authorized lossless submission snapshots. @module judging */
import type { Principal } from "../../identity/model.ts";
export interface SubmissionSnapshots {
  read(principal: Principal, id: string): Promise<string>;
  interview(principal: Principal, interviewId: string, id: string): Promise<string>;
  cancel(principal: Principal, id: string, key: string): Promise<string>;
}
