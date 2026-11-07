import { Tooltip } from "./Tooltip";
import { useId, type ReactNode, type CSSProperties } from "react";
import "./segmented-control.css";

/** One persistent selection, with radio keyboard behavior and shared motion. */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  disabled = false,
  iconOnly = false,
  mono = false,
  compact = false,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly {
    value: Value;
    label: string;
    icon?: ReactNode;
    hint?: string;
    disabled?: boolean;
  }[];
  iconOnly?: boolean;
  mono?: boolean;
  compact?: boolean;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  const id = useId();
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const choose = (next: Value) => {
    if (next !== value) onChange(next);
  };
  return (
    <div
      className="segmented-control"
      data-has-selection={options.some((option) => option.value === value)}
      data-icon-only={iconOnly || undefined}
      data-mono={mono || undefined}
      data-compact={compact || undefined}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      style={{ "--segment-index": selected, "--segment-count": options.length } as CSSProperties}
    >
      <span className="segmented-control-selection" aria-hidden="true" />
      {options.map((option, index) => (
        <Tooltip
          key={option.value}
          content={option.hint ?? option.label}
          disabled={!iconOnly && !option.hint}
        >
          <button
            id={`${id}-${index}`}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={option.value === value}
            disabled={disabled || option.disabled}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => choose(option.value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              let next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (index +
                        (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
                        options.length) %
                      options.length;
              const direction = ["ArrowLeft", "ArrowUp", "End"].includes(event.key) ? -1 : 1;
              for (let count = 0; options[next]?.disabled && count < options.length; count++)
                next = (next + direction + options.length) % options.length;
              if (options[next]?.disabled) return;
              choose(options[next]!.value);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
          >
            {option.icon}
            {(!iconOnly || !option.icon) && option.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
