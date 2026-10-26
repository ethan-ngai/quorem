import "./result-tabs.css";
import { useId } from "react";

/** Shared authoring navigation preserves mounted drafts across keyboard-accessible panels. */
export function AuthoringTabs({
  id: providedId,
  label,
  appearance = "plain",
  tabs,
  value,
  onChange,
}: {
  id?: string;
  label: string;
  appearance?: "plain" | "underline";
  tabs: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div
      className={`result-tabs${appearance === "plain" ? " authoring-section-tabs" : ""}`}
      data-appearance={appearance}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          id={`${id}-${tab.value}`}
          aria-controls={`${id}-${tab.value}-panel`}
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              tabs[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length
              ]!;
            onChange(next.value);
            document.getElementById(`${id}-${next.value}`)?.focus();
            document
              .getElementById(`${id}-${next.value}`)
              ?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
