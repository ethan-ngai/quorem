/** @file OdysseyStepper.tsx @description Shared top-bar navigation across authorized Odyssey stages. @module odyssey */
import type { OdysseyProgress } from "@quorem/contracts";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import "./progress.css";

export function OdysseyStepper({
  progress,
  selectedLevel,
  onSelect,
}: {
  progress: OdysseyProgress & { totalLevels?: number };
  selectedLevel?: number;
  onSelect: (level: number) => void;
}) {
  const selected = Math.min(selectedLevel ?? progress.level, progress.levels.length);
  const total = progress.totalLevels ?? progress.levels.length;
  return (
    <nav className="odyssey-progress" aria-label="Question stages">
      <ol>
        {Array.from({ length: total }, (_, index) => {
          const number = index + 1;
          const level = progress.levels[index];
          const complete = progress.completed || number < progress.level;
          const title = `${number}. ${level?.title ?? "Locked stage"}`;
          const label = `${title}${complete ? ", passed" : !level ? ", locked" : ""}`;
          return (
            <li key={number} data-complete={complete}>
              <Tooltip content={complete ? title : label}>
                <button
                  type="button"
                  disabled={!level}
                  aria-label={label}
                  aria-current={number === selected ? "step" : undefined}
                  onClick={() => onSelect(number)}
                >
                  {complete ? <Icon name="submit" /> : number}
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      <span className="odyssey-current">
        <span>
          Step {selected} of {total}
        </span>
        {progress.levels.map((level, index) => (
          <strong
            key={index}
            className="odyssey-stage-title"
            data-active={selected === index + 1}
            aria-hidden={selected !== index + 1}
          >
            {level.title}
          </strong>
        ))}
      </span>
    </nav>
  );
}
