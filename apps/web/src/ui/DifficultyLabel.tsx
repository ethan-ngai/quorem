/** @file DifficultyLabel.tsx @description Standard difficulty text and semantic color. @module ui */
import type { PublishedQuestion } from "@quorem/contracts";
import { formatLabel } from "./formatLabel";
import "./difficulty.css";

export function DifficultyLabel({ difficulty }: { difficulty: PublishedQuestion["difficulty"] }) {
  return (
    <span className={`difficulty-label difficulty-${difficulty}`}>{formatLabel(difficulty)}</span>
  );
}
