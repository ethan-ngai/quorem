import { useId, useRef, useState } from "react";
import { useChangeMotion } from "../../ui/useChangeMotion";
import * as Popover from "../../ui/Popover";
import { typeTokenClass } from "../editor/components/TypeSyntax";

/** The query is temporary. Only a listed type can change the committed value. */
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
  const [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const expanded = open && !disabled;
  const visible = choices.filter((choice) =>
    `${names?.[choice] ?? ""} ${choice}`.toLowerCase().includes(query?.trim().toLowerCase() ?? ""),
  );
  const results = useChangeMotion<HTMLDivElement>(visible.join(","));
  const activeChoice = visible[active];
  const optionId = (choice: T) => `${id}-${encodeURIComponent(choice)}`;
  function close() {
    setOpen(false);
    setQuery(undefined);
  }
  function show() {
    if (expanded) return;
    setActive(Math.max(0, value ? choices.indexOf(value) : 0));
    setOpen(true);
  }
  function choose(choice: T) {
    onChange(choice);
    close();
    input.current?.select();
  }
  return (
    <Popover.Root
      open={expanded}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Popover.Anchor asChild>
        <input
          ref={input}
          className={`authoring-type-input ${typeTokenClass((expanded ? query : undefined) ?? value ?? "")}`}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={expanded ? id : undefined}
          aria-expanded={expanded}
          aria-activedescendant={expanded && activeChoice ? optionId(activeChoice) : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder="Type"
          value={(expanded ? query : undefined) ?? value ?? ""}
          onFocus={(event) => {
            event.currentTarget.select();
            show();
          }}
          onClick={show}
          onBlur={close}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              close();
              event.currentTarget.select();
            } else if (event.key === "Enter" && expanded) {
              event.preventDefault();
              if (activeChoice) choose(activeChoice);
              else close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) {
                show();
              } else if (visible.length) {
                const next =
                  (active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
                setActive(next);
                document
                  .getElementById(optionId(visible[next]!))
                  ?.scrollIntoView({ block: "nearest" });
              }
            }
          }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="authoring-type-menu"
          aria-label={label}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === input.current) event.preventDefault();
          }}
        >
          <div id={id} ref={results} role="listbox" aria-label="Types">
            {visible.map((choice, index) => (
              <button
                type="button"
                role="option"
                aria-selected={choice === value}
                data-active={index === active}
                id={optionId(choice)}
                key={choice}
                tabIndex={-1}
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(choice)}
              >
                {names?.[choice] && <span>{names[choice]}</span>}
                <code className={typeTokenClass(choice)}>{choice}</code>
              </button>
            ))}
          </div>
          {!visible.length && <p role="status">No matching types.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
