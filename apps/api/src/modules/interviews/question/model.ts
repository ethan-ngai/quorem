/** @file model.ts @description Interview question command boundaries. @module interviews */
import type { Principal } from "../../identity/model.ts";
export type HintVisibility = { topics?: boolean | null; complexity?: boolean | null };
export interface InterviewQuestions {
  select(
    actor: Principal,
    id: string,
    key: string,
    question: unknown,
    rawBody?: string,
  ): Promise<string>;
  hints(actor: Principal, id: string, key: string, hints: HintVisibility): Promise<string>;
  language(
    actor: Principal,
    id: string,
    key: string,
    language: string,
    epoch: string,
  ): Promise<string>;
  passStage(
    actor: Principal,
    id: string,
    key: string,
    epoch: string,
    level: number,
  ): Promise<string>;
  caseVisibility(
    actor: Principal,
    id: string,
    key: string,
    caseId: string,
    revealed: boolean,
    epoch: string,
  ): Promise<string>;
}
