import "./difficulty-segments.css";
import "./selection-feedback.css";

export type Difficulty = "easy" | "medium" | "hard";
const difficulties: Difficulty[] = ["easy", "medium", "hard"];

export function DifficultySegments({
  selected,
  onChange,
  disabled = false,
  required = false,
  single = false,
}: {
  selected: readonly Difficulty[];
  onChange: (selected: Difficulty[]) => void;
  disabled?: boolean;
  required?: boolean;
  single?: boolean;
}) {
  return (
    <div className="difficulty-segments" role="group" aria-label="Difficulty filter">
      {difficulties.map((difficulty) => (
        <button
          type="button"
          className="selection-feedback"
          key={difficulty}
          aria-pressed={selected.includes(difficulty)}
          disabled={
            disabled || (required && selected.length === 1 && selected.includes(difficulty))
          }
          onClick={() =>
            onChange(
              single
                ? [difficulty]
                : selected.includes(difficulty)
                  ? selected.filter((value) => value !== difficulty)
                  : [...selected, difficulty],
            )
          }
        >
          <span className={`difficulty-${difficulty}`}>
            {difficulty[0]!.toUpperCase() + difficulty.slice(1)}
          </span>
        </button>
      ))}
    </div>
  );
}
