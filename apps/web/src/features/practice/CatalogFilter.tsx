/** @file CatalogFilter.tsx @description Shared catalog filter popover. @module practice */
import { useRef, useState } from "react";
import { ScrollCue } from "../../ui/ScrollCue";
import { SearchField } from "../../ui/SearchField";
import { useChangeMotion } from "../../ui/useChangeMotion";
import * as Popover from "../../ui/Popover";
import { ChevronDown } from "lucide-react";
import "../../ui/select-field.css";

export function CatalogFilter({
  label,
  selected,
  options,
  featuredOptions,
  searchPlaceholder,
  onChange,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  featuredOptions?: { value: string; label: string }[];
  searchPlaceholder?: string;
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const popover = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const summary = useChangeMotion<HTMLSpanElement>(selected.join(","));
  const groups = featuredOptions?.length
    ? [
        { label: "Foundational", options: featuredOptions },
        { label: "Other topics", options },
      ]
    : [{ label: "", options }];
  const term = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      options: term
        ? group.options.filter((option) => option.label.toLowerCase().includes(term))
        : group.options,
    }))
    .filter((group) => group.options.length > 0);
  const choices = visibleGroups.map((group) => (
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
  ));
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) setQuery("");
      }}
    >
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
          ref={popover}
          className="select-field-menu practice-filter-popover"
          data-searchable={searchPlaceholder ? "" : undefined}
          onOpenAutoFocus={(event) => {
            if (!searchInput.current) return;
            event.preventDefault();
            searchInput.current.focus();
          }}
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
          {searchPlaceholder ? (
            <>
              <SearchField
                ref={searchInput}
                shortcutTarget={popover}
                className="practice-filter-search"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ScrollCue resetKey={term} className="practice-filter-results">
                {choices}
                {visibleGroups.length === 0 && (
                  <div className="practice-filter-empty" role="status">
                    {term ? "No matches" : `No ${label.toLowerCase()} available`}
                  </div>
                )}
              </ScrollCue>
            </>
          ) : (
            choices
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
