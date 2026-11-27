/** @file CompanyRecency.tsx @description Company recency controls and row icons. @module practice */
import { Archive, CalendarDays, CalendarRange, Clock3, History } from "lucide-react";
import * as Popover from "../../ui/Popover";
import type { CatalogPage } from "./problemQueries";
import "../../ui/selection-feedback.css";
import "./company-recency.css";

type Evidence = NonNullable<CatalogPage["companyEvidence"]>;
type Window = Evidence["observations"][string]["window"];

const windows = {
  "30d": { label: "30-day window", Icon: Clock3 },
  "3m": { label: "3-month window", Icon: CalendarDays },
  "6m": { label: "6-month window", Icon: CalendarRange },
  older: { label: "Older than 6 months", Icon: History },
  all: { label: "All-time only", Icon: Archive },
} satisfies Record<Window, { label: string; Icon: typeof Clock3 }>;

/** Toggle the company-specific sort without changing filters. */
export function CompanyRecencySort({ active, toggle }: { active: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className="button button-secondary selection-feedback company-recency-sort"
      aria-pressed={active}
      onClick={toggle}
    >
      <Clock3 size={16} aria-hidden="true" />
      Recent first
    </button>
  );
}

/** Reveal the icon's window on hover, keyboard activation, or tap. */
export function CompanyRecencyIcon({ window }: { window?: Window }) {
  if (!window) return null;
  const { label, Icon } = windows[window];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="company-recency-icon"
          aria-label={`Recency: ${label}`}
          title={label}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Company recency" className="company-recency-hint" side="top">
          {label}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
