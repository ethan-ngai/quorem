import { useChangeMotion } from "../../ui/useChangeMotion";
import * as Popover from "../../ui/Popover";
import { ChevronDown } from "lucide-react";
import "../../ui/select-field.css";

export function CatalogFilter({
  label,
  selected,
  options,
  featuredOptions,
  onChange,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  featuredOptions?: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}) {
  const summary = useChangeMotion<HTMLSpanElement>(selected.join(","));
  const groups = featuredOptions?.length
    ? [
        { label: "Foundational", options: featuredOptions },
        { label: "Other topics", options },
      ]
    : [{ label: "", options }];
  return (
    <Popover.Root>
      <Popover.Trigger className="select-field practice-filter-trigger" aria-label={label}>
        {label}
        {selected.length > 0 && (
          <span className="practice-filter-summary motion-reveal" ref={summary}>
            {
              groups
                .flatMap((group) => group.options)
                .find((option) => option.value === selected[0])?.label
            }
            {selected.length > 1 && ` +${selected.length - 1}`}
          </span>
        )}
        <ChevronDown className="select-field-chevron" size={14} aria-hidden="true" />
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
          {groups
            .filter((group) => group.options.length > 0)
            .map((group) => (
              <div key={group.label} className="practice-filter-group">
                {group.label && <div className="practice-filter-group-label">{group.label}</div>}
                <div
                  className="practice-filter-choices"
                  data-layout={group.options.length > 3 ? "grid" : "row"}
                  role="group"
                  aria-label={group.label || label}
                >
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="practice-filter-choice"
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
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
