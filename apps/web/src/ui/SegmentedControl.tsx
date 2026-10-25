import { Tooltip } from "./Tooltip";
import { useId, type ReactNode, type CSSProperties } from "react";
import "./segmented-control.css";

/** One persistent selection, with radio keyboard behavior and shared motion. */
export function SegmentedControl({
  label,
  value,
  options,
  disabled = false,
  iconOnly = false,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; icon?: ReactNode }[];
  iconOnly?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      className="segmented-control"
      data-icon-only={iconOnly || undefined}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      style={{ "--segment-index": selected, "--segment-count": options.length } as CSSProperties}
    >
      <span className="segmented-control-selection" aria-hidden="true" />
      {options.map((option, index) => (
        <Tooltip key={option.value} content={option.label} disabled={!iconOnly}>
          <button
            id={`${id}-${index}`}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={option.value === value}
            disabled={disabled}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (index +
                        (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
                        options.length) %
                      options.length;
              onChange(options[next]!.value);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
          >
            {iconOnly ? (option.icon ?? option.label) : option.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
