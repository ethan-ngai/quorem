import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import * as Popover from "../../ui/Popover";
import "../editor/components/code-literal.css";

export function SearchableTypeSelect<T extends string>({
  label,
  value,
  choices,
  names,
  disabled,
  onChange,
}: {
  label: string;
  value?: T;
  choices: readonly T[];
  names?: Partial<Record<T, string>>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const visible = choices.filter((choice) =>
    `${names?.[choice] ?? ""} ${choice}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  function choose(choice: T) {
    onChange(choice);
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) {
          setQuery("");
          setActive(Math.max(0, value ? choices.indexOf(value) : 0));
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="select-field authoring-type-trigger"
          aria-label={`${label}: ${value ?? "choose type"}`}
          disabled={disabled}
        >
          <code className="code-type">{value ?? "Choose type"}</code>
          <ChevronDown className="select-field-chevron" size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="authoring-type-menu"
          aria-label={label}
          align="start"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <input
            ref={input}
            className="authoring-type-search"
            role="combobox"
            aria-label={`Search ${label.toLowerCase()}`}
            aria-autocomplete="list"
            aria-controls={id}
            aria-expanded={open}
            aria-activedescendant={
              visible[active] ? `${id}-${encodeURIComponent(visible[active])}` : undefined
            }
            placeholder="Search types"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (!visible.length) return;
              if (event.key === "Enter" && visible[active]) {
                event.preventDefault();
                choose(visible[active]);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  (active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
                setActive(next);
                document
                  .getElementById(`${id}-${encodeURIComponent(visible[next]!)}`)
                  ?.scrollIntoView({ block: "nearest" });
              }
            }}
          />
          <div id={id} role="listbox" aria-label="Types">
            {visible.map((choice, index) => (
              <button
                type="button"
                role="option"
                aria-selected={choice === value}
                data-active={index === active}
                id={`${id}-${encodeURIComponent(choice)}`}
                key={choice}
                tabIndex={-1}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(choice)}
              >
                {names?.[choice] && <span>{names[choice]}</span>}
                <code className="code-type">{choice}</code>
              </button>
            ))}
          </div>
          {!visible.length && <p role="status">No matching types.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
