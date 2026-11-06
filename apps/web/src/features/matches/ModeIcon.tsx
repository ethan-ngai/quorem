/** @file ModeIcon.tsx @description Shared competitive mode artwork. @module matches */
import type { PartySettings } from "@quorem/contracts";
import { Swords } from "lucide-react";
import { FreeForAllIcon } from "./FreeForAllIcon";

export function ModeIcon({ mode }: { mode: PartySettings["mode"] }) {
  return mode === "free-for-all" ? (
    <FreeForAllIcon />
  ) : (
    <Swords size={18} strokeWidth={1.5} aria-hidden="true" />
  );
}
