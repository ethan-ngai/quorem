/** @file model.ts @description Authorized lossless submission snapshots. @module judging */
import type { Principal } from "../../identity/model.ts";
export interface SubmissionSnapshots {
  read(principal: Principal, id: string): Promise<ReadableStream<Uint8Array>>;
  interview(
    principal: Principal,
    interviewId: string,
    id: string,
  ): Promise<ReadableStream<Uint8Array>>;
  cancel(principal: Principal, id: string, key: string): Promise<string>;
}
