/** @file PageSizeControl.tsx @description Editable page size with keyboard-accessible presets. @module ui */
import { pageSizeSchema } from "@quorem/contracts/pagination";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import * as Popover from "./Popover";
import { TextInput } from "./TextControl";
import { inputConstraints } from "./input-constraints";
import "./page-size-control.css";

const presets = [10, 20, 50, 100];
const constraint = inputConstraints.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });

export function PageSizeControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (size: number) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function choose(next: number) {
    setDraft(String(next));
    input.current?.setCustomValidity("");
    setOpen(false);
    setActive(-1);
    if (next !== value) onChange(next);
  }
  function commit(report: boolean) {
    const result = pageSizeSchema.safeParse(Number(draft));
    if (result.success) choose(result.data);
    else if (report) {
      input.current?.setCustomValidity("Enter a positive whole number.");
      input.current?.reportValidity();
    } else {
      setDraft(String(value));
      input.current?.setCustomValidity("");
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      input.current?.focus();
      setOpen(true);
      setActive((current) =>
        current < 0
          ? event.key === "ArrowDown"
            ? 0
            : presets.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + presets.length) % presets.length,
      );
    } else if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      if (open && active >= 0) choose(presets[active]);
      else commit(true);
    } else if (event.key === "Escape" && (open || draft !== String(value))) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(String(value));
      input.current?.setCustomValidity("");
      setOpen(false);
      setActive(-1);
    }
  }
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        setActive(-1);
        if (next) input.current?.focus();
      }}
    >
      <Popover.Anchor asChild>
        <div
          className="page-size-control focus-within-ring"
          data-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) commit(false);
          }}
        >
          <TextInput
            unstyled
            ref={input}
            constraint={constraint}
            type="text"
            inputMode="numeric"
            role="combobox"
            aria-label="Rows per page"
            aria-expanded={open && !disabled}
            aria-controls={listId}
            aria-autocomplete="none"
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            value={draft}
            disabled={disabled}
            style={{ width: `${Math.max(2, draft.length)}ch` }}
            onChange={(event) => {
              setDraft(event.target.value);
              setActive(-1);
              input.current?.setCustomValidity("");
            }}
          />
          <span aria-hidden="true">per page</span>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Choose rows per page"
              tabIndex={-1}
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="page-size-options"
          role="listbox"
          id={listId}
          aria-label="Page size presets"
          align="end"
          side="top"
          sideOffset={6}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {presets.map((size, index) => (
            <button
              key={size}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={value === size}
              tabIndex={-1}
              data-active={active === index || undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(size)}
            >
              <span>{size}</span>
              {value === size && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
