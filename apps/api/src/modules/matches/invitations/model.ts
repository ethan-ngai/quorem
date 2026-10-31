/** @file model.ts @description Match invitation command ports. @module matches */
import type { Principal } from "../../identity/model.ts";
export interface MatchInvitations {
  preview(token: string): Promise<unknown>;
  join(who: Principal, key: string, token: string): Promise<unknown>;
  joinGuest(token: string, credential: string, name: string): Promise<unknown>;
  rotate(who: Principal, id: string, key: string): Promise<unknown>;
  removeGuest(who: Principal, id: string, guest: string, key: string): Promise<unknown>;
}
