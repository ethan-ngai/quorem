/** @file model.ts @description Interview lifecycle boundaries. @module interviews */
import type { Principal } from "../../identity/model.ts";
export type InterviewRole = "interviewer" | "interviewee";
export interface InvitePreview {
  title: string;
  sessionId: string;
  state: string;
  role: InterviewRole;
}
export interface InterviewCreate {
  title: string;
  question: unknown;
  monitoring?: unknown;
  /** Transport-owned raw JSON for operation identity. */
  rawBody?: string;
}
export interface JoinResult {
  id: string;
  credential?: string;
}
export interface InterviewLifecycle {
  create(actor: Principal, key: string, command: InterviewCreate): Promise<string>;
  list(actor: Principal): Promise<string[]>;
  read(actor: Principal, id: string): Promise<ReadableStream<Uint8Array>>;
  preview(token: string): Promise<InvitePreview>;
  join(
    actor: Principal | undefined,
    token: string,
    credential: string | undefined,
    name: string,
  ): Promise<JoinResult>;
  setMember(
    actor: Principal,
    id: string,
    key: string,
    target: string,
    role: InterviewRole,
  ): Promise<string>;
  removeMember(actor: Principal, id: string, key: string, target: string): Promise<string>;
  setAdmission(actor: Principal, id: string, key: string, locked: boolean): Promise<string>;
  close(actor: Principal, id: string, key: string): Promise<string>;
  delete(actor: Principal, id: string): Promise<void>;
}
