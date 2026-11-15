import { useHotkey } from "@tanstack/react-hotkeys";
import { Search } from "lucide-react";
import { useRef, type ComponentPropsWithoutRef, type RefObject } from "react";
import { ShortcutKeys } from "./ShortcutKeys";
import { DelayedSpinner } from "./Spinner";
import "./search-field.css";

const searchKey = "/";

export function SearchField({
  className,
  disabled,
  ref,
  shortcutTarget,
  refreshing,
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  ref?: RefObject<HTMLInputElement | null>;
  shortcutTarget?: RefObject<HTMLElement | null>;
  refreshing?: boolean;
}) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = ref ?? localInput;

  useHotkey(
    { key: searchKey },
    (event) => {
      const dialog =
        event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
      if (event.defaultPrevented || (dialog && !dialog.contains(input.current))) return;
      event.preventDefault();
      input.current?.focus();
    },
    {
      enabled: !disabled,
      ignoreInputs: true,
      target: shortcutTarget,
      preventDefault: false,
      stopPropagation: false,
    },
  );

  return (
    <label className={`search-field focus-within-ring${className ? ` ${className}` : ""}`}>
      <DelayedSpinner
        active={!!refreshing}
        label="Updating results"
        fallback={<Search size={16} strokeWidth={1.5} aria-hidden="true" />}
      />
      <input
        {...props}
        ref={input}
        type="search"
        disabled={disabled}
        aria-keyshortcuts={disabled ? undefined : searchKey}
      />
      {!disabled && (
        <span aria-hidden="true">
          <ShortcutKeys keys={[searchKey]} />
        </span>
      )}
    </label>
  );
}
