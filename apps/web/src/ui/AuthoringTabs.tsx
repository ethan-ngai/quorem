import "./result-tabs.css";
import { useId, type ReactNode } from "react";

/** Shared authoring navigation preserves mounted drafts across keyboard-accessible panels. */
export function AuthoringTabs<Value extends string>({
  id: providedId,
  label,
  appearance = "plain",
  tabs,
  value,
  onChange,
  tabId,
  panelId,
}: {
  id?: string;
  label: string;
  appearance?: "plain" | "underline" | "default";
  tabs: readonly { value: Value; label: ReactNode; icon?: ReactNode }[];
  value: Value;
  onChange: (value: Value) => void;
  tabId?: (value: Value) => string;
  panelId?: (value: Value) => string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const getTabId = (value: Value) => tabId?.(value) ?? `${id}-${value}`;
  return (
    <div
      className={`result-tabs${appearance === "plain" ? " authoring-section-tabs" : ""}`}
      data-appearance={appearance === "default" ? undefined : appearance}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          id={getTabId(tab.value)}
          aria-controls={panelId?.(tab.value) ?? `${id}-${tab.value}-panel`}
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
            document.getElementById(getTabId(next.value))?.focus();
            if (appearance !== "default")
              document
                .getElementById(getTabId(next.value))
                ?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
