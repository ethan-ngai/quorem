/** @file model.ts @description Match workspace-language command port. @module matches */
import type { Principal } from "../../identity/model.ts";
export interface MatchLanguageSelection {
  switchLanguage(who: Principal, id: string, key: string, language: string): Promise<unknown>;
}
