import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import "../../ui/select-field.css";

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
    <Popover.Root>
      <Popover.Trigger className="select-field practice-filter-trigger" aria-label={label}>
        {label}
        {selected.length > 0 && (
          <span className="practice-filter-summary">
            {options.find((option) => option.value === selected[0])?.label}
            {selected.length > 1 && ` +${selected.length - 1}`}
          </span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="select-field-menu practice-filter-popover"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={`${label} filters`}
        >
          <div className="practice-filter-header">
            <span>{label}</span>
            <button type="button" disabled={!selected.length} onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="practice-filter-choices" role="group" aria-label={label}>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
