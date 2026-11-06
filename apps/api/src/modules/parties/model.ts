/** @file model.ts @description Persistent party settings and lifecycle port. @module parties */
import { ApplicationError } from "../../application/error.ts";
import type { Principal } from "../identity/model.ts";
import { normalizeSettings, type Settings } from "../matches/lifecycle/model.ts";
export type PartySettings = Settings & { shareCodeAfterMatch: boolean };
export function normalizePartySettings(value: unknown): PartySettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError("invalid_input", "Invalid party settings", 400);
  const { shareCodeAfterMatch, ...rest } = value as Record<string, unknown>;
  if (shareCodeAfterMatch !== undefined && typeof shareCodeAfterMatch !== "boolean")
    throw new ApplicationError("invalid_input", "Invalid sharing setting", 400);
  return { ...normalizeSettings(rest), shareCodeAfterMatch: shareCodeAfterMatch !== false };
}
export interface Parties {
  current(who: Principal): Promise<unknown>;
  read(who: Principal, id: string): Promise<unknown>;
  create(who: Principal, key: string, settings: PartySettings): Promise<unknown>;
  preview(token: string): Promise<unknown>;
  join(who: Principal, key: string, token: string): Promise<unknown>;
  joinGuest(token: string, credential: string, name: string): Promise<unknown>;
  mutate(
    who: Principal,
    id: string,
    key: string,
    action: "settings" | "ready" | "start" | "leave" | "disband",
    body: PartySettings | boolean | null,
  ): Promise<unknown>;
  heartbeat(who: Principal, windowId: string): Promise<unknown>;
}
