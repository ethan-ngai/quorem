/** @file ModeIcon.tsx @description Shared competitive mode artwork. @module matches */
import type { PartySettings } from "@quorem/contracts";
import { Swords, Users } from "lucide-react";
import { FreeForAllIcon } from "./FreeForAllIcon";

export const matchModeLabels = {
  showdown: "Showdown",
  "free-for-all": "Free-for-all",
  factions: "Factions",
} satisfies Record<NonNullable<PartySettings["mode"]>, string>;

export function ModeIcon({ mode }: { mode: PartySettings["mode"] }) {
  return mode === "factions" ? (
    <Users size={18} strokeWidth={1.5} aria-hidden="true" />
  ) : mode === "free-for-all" ? (
    <FreeForAllIcon />
  ) : (
    <Swords size={18} strokeWidth={1.5} aria-hidden="true" />
  );
}
