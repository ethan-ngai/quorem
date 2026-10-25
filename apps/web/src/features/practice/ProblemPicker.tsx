/** @file ProblemPicker.tsx @description Shared searchable question picker for session setup. @module practice */
import * as Popover from "../../ui/Popover";
import { useRef, useState } from "react";
import { Dices, Search } from "lucide-react";
import { Icon } from "../editor/components/Icon";
import "../matches/competitive.css";

export function ProblemPicker({
  items,
  value,
  onChange,
  disabled,
  allowRandom = false,
  onSearchChange,
}: {
  items: readonly { id: string; title: string; difficulty?: string }[];
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  allowRandom?: boolean;
  onSearchChange?: (search: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<{ id: string; title: string }>();
  const input = useRef<HTMLInputElement>(null);
  const selected =
    items.find((item) => item.id === value) ?? (chosen?.id === value ? chosen : undefined);
  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  function choose(id: string | undefined) {
    setChosen(items.find((item) => item.id === id));
    onChange(id);
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setSearch("");
          onSearchChange?.("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="select-field match-choice problem-picker-trigger"
          disabled={disabled}
          aria-label="Problem"
        >
          <span>
            {!value && allowRandom && <Dices size={16} />}
            {selected?.title ??
              (value ? "Selected problem" : allowRandom ? "Random" : "Choose question")}
          </span>
          <span className="select-field-chevron">
            <Icon name="chevron" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="problem-picker-popover"
          sideOffset={8}
          collisionPadding={12}
          align="end"
          aria-label="Choose problem"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <label className="problem-picker-search">
            <Search size={16} />
            <input
              ref={input}
              aria-label="Search problems"
              placeholder="Search problems"
              value={search}
              maxLength={120}
              onChange={(event) => {
                setSearch(event.target.value);
                onSearchChange?.(event.target.value);
              }}
            />
          </label>
          <div className="problem-picker-results" role="group" aria-label="Matching problems">
            {allowRandom && (
              <button
                type="button"
                className="problem-picker-item"
                aria-pressed={!value}
                onClick={() => choose(undefined)}
              >
                <Dices size={18} />
                <span>Random</span>
                {!value && <Icon name="submit" />}
              </button>
            )}
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className="problem-picker-item"
                aria-pressed={value === item.id}
                onClick={() => choose(item.id)}
              >
                {value === item.id && <Icon name="submit" />}
                <span>{item.title}</span>
                {item.difficulty && (
                  <small className={`difficulty-${item.difficulty}`}>{item.difficulty}</small>
                )}
              </button>
            ))}
            {!filtered.length && <p role="status">No matching problems</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
