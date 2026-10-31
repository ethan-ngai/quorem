/** @file model.ts @description Interview document command contracts. @module interviews */
import type { Principal } from "../../identity/model.ts";
export type DocumentUpdate = { clientID: string; changes: unknown };
export type DocumentPush = { version: number; epoch: string; updates: DocumentUpdate[] };
export type DocumentBatch = DocumentPush;
export type InterviewDocument = { source: string; version: number; epoch: string };
export interface InterviewDocuments {
  read(actor: Principal, id: string): Promise<InterviewDocument>;
  pull(actor: Principal, id: string, epoch: string, version: number): Promise<DocumentBatch>;
  push(
    actor: Principal,
    id: string,
    key: string,
    batch: DocumentPush,
    rawBody?: string,
  ): Promise<DocumentBatch>;
}
