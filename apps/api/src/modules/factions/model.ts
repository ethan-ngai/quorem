/** @file model.ts @description Team-scoped commands behind authenticated transports. @module factions */
import type { Principal } from "../identity/model.ts";
export interface Factions {
  lobby(actor: Principal, id: string): Promise<unknown>;
  organize(
    actor: Principal,
    id: string,
    key: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
  read(actor: Principal, id: string): Promise<unknown>;
  authorizeSocket(actor: Principal, id: string, team: number): Promise<void>;
  command(
    actor: Principal,
    id: string,
    key: string,
    action: string,
    body: Record<string, unknown>,
    expectedTeam?: number,
  ): Promise<unknown>;
}
