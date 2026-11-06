/** @file ModeText.tsx @description Stable-width mode labels with a brief crossfade. @module matches */
import type { ReactNode } from "react";
import type { MatchSnapshot } from "@quorem/contracts";

export function ModeText({
  mode,
  showdown,
  freeForAll,
  factions = "Factions",
}: {
  mode: MatchSnapshot["mode"];
  showdown: ReactNode;
  freeForAll: ReactNode;
  factions?: ReactNode;
}) {
  return (
    <span className="mode-text">
      <span
        className="mode-text-option"
        data-active={mode === "showdown"}
        aria-hidden={mode !== "showdown"}
      >
        {showdown}
      </span>
      <span
        className="mode-text-option"
        data-active={mode === "free-for-all"}
        aria-hidden={mode !== "free-for-all"}
      >
        {freeForAll}
      </span>
      <span
        className="mode-text-option"
        data-active={mode === "factions"}
        aria-hidden={mode !== "factions"}
      >
        {factions}
      </span>
    </span>
  );
}
