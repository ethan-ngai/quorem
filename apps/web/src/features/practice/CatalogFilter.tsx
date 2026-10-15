export function CatalogFilter({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="practice-filter-group" role="group" aria-label={label}>
      <span className="practice-filter-label" aria-hidden="true">
        {label}
      </span>
      <div className="practice-filter-choices">
        <button
          type="button"
          className="practice-filter-choice"
          aria-pressed={!selected.length}
          onClick={() => onChange([])}
        >
          Any
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`practice-filter-choice${label === "Difficulty" ? ` practice-filter-choice--${option.value}` : ""}`}
            aria-pressed={selected.includes(option.value)}
            disabled={selected.length >= 16 && !selected.includes(option.value)}
            onClick={() =>
              onChange(
                selected.includes(option.value)
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
