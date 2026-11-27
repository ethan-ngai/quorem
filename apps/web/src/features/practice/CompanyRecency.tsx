/** @file CompanyRecency.tsx @description Company recency controls and snapshot labels. @module practice */
import { Clock3 } from "lucide-react";
import type { CatalogPage } from "./problemQueries";
import "../../ui/selection-feedback.css";
import "./company-recency.css";

type Evidence = NonNullable<CatalogPage["companyEvidence"]>;
type Window = Evidence["observations"][string]["window"];

const windowLabels: Record<Window, string> = {
  "30d": "Within 30 days",
  "3m": "Within 3 months",
  "6m": "Within 6 months",
  older: "Over 6 months",
  all: "All-time only",
};
const snapshotDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

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

/** Date anchors every evidence window to the same source snapshot. */
export function CompanyEvidenceSource({ evidence }: { evidence: Evidence }) {
  return (
    <p className="company-evidence-source">
      {evidence.company} snapshot ·{" "}
      <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
        <time dateTime={evidence.snapshotDate}>
          {snapshotDate.format(new Date(evidence.snapshotDate))}
        </time>
      </a>
    </p>
  );
}

/** Render the source's shortest window in the question row. */
export function CompanyEvidenceLabel({ window }: { window?: Window }) {
  return window ? <span className="company-evidence-label">{windowLabels[window]}</span> : null;
}
