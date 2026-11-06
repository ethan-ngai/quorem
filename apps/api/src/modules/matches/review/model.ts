/** @file model.ts @description Completed match review port. @module matches */
import type { Principal } from "../../identity/model.ts";

export interface MatchReview {
  read(principal: Principal, matchId: string): Promise<string>;
}
