import "./results.css";
/** @file ResultContent.tsx @description Safe submission summaries and selected public Run output. @module editor */
import type { Diagnostic, ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
import { useState } from "react";
import { Icon } from "../../../ui/Icon";
import { CaseOutput, verdictTone } from "./CaseOutput";

/** Shows safe compiler or public-case diagnostics with useful source positions. */
function Diagnostics({ items }: { items?: Diagnostic[] }) {
  return items?.length ? (
    <ul className="diagnostic-list">
      {items.map((diagnostic, index) => (
        <li key={index}>
          {diagnostic.line != null && (
            <span>
              Line {diagnostic.line}
              {diagnostic.column != null ? `:${diagnostic.column}` : ""} ·{" "}
            </span>
          )}
          {diagnostic.message}
        </li>
      ))}
    </ul>
  ) : null;
}

/** Shows outputs from the admitted Run snapshot; editable inputs are deliberately excluded. */
function RunCaseResults({
  cases,
  sql,
}: {
  cases: PublicCaseResult[];
  sql?: ProblemVersion["sql"];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, cases.length - 1));
  const selected = cases[activeIndex];
  return (
    <div className="case-browser">
      <div className="case-rail" aria-label="Select run result">
        {cases.map((result, index) => (
          <button
            key={result.index}
            className="case-selector"
            aria-pressed={activeIndex === index}
            aria-label={`Case ${result.index + 1}: ${result.status.replaceAll("_", " ")}`}
            onClick={() => setSelectedIndex(index)}
          >
            {result.status !== "executed" && (
              <Icon
                name={result.status === "accepted" ? "submit" : "close"}
                className={verdictTone(result.status)}
              />
            )}
            Case {result.index + 1}
          </button>
        ))}
      </div>
      {selected && (
        <div className="case-details">
          <CaseOutput result={selected} sql={sql} />
        </div>
      )}
    </div>
  );
}

/** Renders a single result summary without exposing hidden suite inputs or stale admission results. */
export function ResultContent({
  submission,
  busy,
  error,
  showCases = true,
  detailsVisible = false,
  customMode,
  runWasCustom = false,
  showVerdict = true,
  sql,
}: {
  submission?: Submission;
  busy: boolean;
  error?: string;
  showCases?: boolean;
  detailsVisible?: boolean;
  customMode?: boolean;
  runWasCustom?: boolean;
  showVerdict?: boolean;
  sql?: ProblemVersion["sql"];
}) {
  // Results belong to their admitted collection, regardless of the currently selected tab.
  if (
    submission &&
    customMode !== undefined &&
    customMode !== (submission.kind === "run" && runWasCustom)
  )
    return null;
  if (error) return null;
  if (busy)
    return (
      <p className="result-message" role="status">
        Starting…
      </p>
    );
  if (!submission)
    return showVerdict ? <p className="result-message">Run your code to see results.</p> : null;
  if (submission.state === "queued" || submission.state === "running")
    return (
      <div className="result-running" role="status">
        <span className="running-marker" aria-hidden="true" />
        <strong>{submission.state === "queued" ? "Queued" : "Running"}</strong>
      </div>
    );
  if (submission.state === "failed")
    return (
      <p className="result-message result-error">
        Judge unavailable. Your source is safe. {submission.infrastructureError}
      </p>
    );
  if (submission.state === "cancelled") return <p className="result-message">Run cancelled</p>;
  if (
    !showVerdict &&
    !submission.diagnostics?.length &&
    (!showCases || !submission.publicCases?.length)
  )
    return null;
  const verdict =
    submission.verdict?.replaceAll("_", " ") ??
    (submission.kind === "run" ? "Executed" : "Completed");
  const compared = submission.publicCases?.filter((item) => item.status !== "executed") ?? [];
  const passed = compared.filter((item) => item.status === "accepted").length;
  return (
    <div className="result-complete">
      {(showVerdict || !!submission.diagnostics?.length) && (
        <div className="result-summary">
          {showVerdict && (
            <div className={`verdict-line ${verdictTone(submission.verdict)}`}>
              {submission.score || (submission.kind === "run" && compared.length) ? (
                <span className="run-overview">
                  <Icon
                    name={
                      submission.kind === "submit" && !detailsVisible
                        ? "lock"
                        : (submission.score?.passed ?? passed) ===
                            (submission.score?.total ?? compared.length)
                          ? "submit"
                          : "close"
                    }
                  />
                  <span>
                    {submission.score?.passed ?? passed}/
                    {submission.score?.total ?? compared.length} cases passed
                  </span>
                </span>
              ) : (
                <strong>{verdict}</strong>
              )}
            </div>
          )}
          <Diagnostics items={submission.diagnostics} />
        </div>
      )}
      {showCases && submission.publicCases?.length ? (
        <RunCaseResults key={submission.id} cases={submission.publicCases} sql={sql} />
      ) : null}
    </div>
  );
}
