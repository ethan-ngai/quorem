/** @file ModeIcon.tsx @description Shared competitive mode artwork. @module matches */
import type { CreateMatchRequest } from "@quorem/contracts";
import { Swords } from "lucide-react";
import { FreeForAllIcon } from "./FreeForAllIcon";

export function ModeIcon({ mode }: { mode: CreateMatchRequest["mode"] }) {
  return mode === "free-for-all" ? (
    <FreeForAllIcon />
  ) : (
    <Swords size={18} strokeWidth={1.5} aria-hidden="true" />
  );
}
