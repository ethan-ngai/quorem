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
      <Popover.Trigger className="select-field select-field--filter" aria-label={label}>
        {label}
        {selected.length > 0 && <span className="practice-filter-count">{selected.length}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="select-field-menu practice-filter-menu"
          align="end"
          sideOffset={5}
          collisionPadding={12}
          aria-label={`${label} filters`}
        >
          <div className="practice-filter-options">
            {options.map((option) => (
              <label key={option.value} className="practice-filter-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  disabled={selected.length >= 16 && !selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="practice-filter-reset"
            disabled={!selected.length}
            onClick={() => onChange([])}
          >
            Clear {label.toLowerCase()}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
