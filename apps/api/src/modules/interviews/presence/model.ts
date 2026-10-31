/** @file model.ts @description Interview presence and connection leases. @module interviews */
import type { Principal } from "../../identity/model.ts";
export type PresenceInput = {
  clientID: string;
  epoch: string;
  version: number;
  anchor: number;
  head: number;
};
export type Presence = PresenceInput & { userId: string; name: string; color?: number };
export interface InterviewPresence {
  peers(actor: Principal, id: string): Promise<Presence[]>;
  update(actor: Principal, id: string, input: PresenceInput): Promise<Presence[]>;
  acquire(actor: Principal, id: string): Promise<string>;
  renew(actor: Principal, id: string, lease: string): Promise<boolean>;
  release(actor: Principal, id: string, lease: string): Promise<void>;
}
