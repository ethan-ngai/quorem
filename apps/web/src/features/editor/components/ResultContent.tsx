import "./results.css";
import { verdictIcon } from "./verdictPresentation";
/** @file ResultContent.tsx @description Safe submission summaries and selected public Run output. @module editor */
import type {
  Diagnostic,
  PublishedQuestion,
  PublicCaseResult,
  Submission,
} from "@quorem/contracts";
import { useState } from "react";
import { Icon } from "../../../ui/Icon";
import { LoadingIndicator } from "../../../ui/Spinner";
import { NoticeRegion } from "../../../ui/PersistentNotice";
import { CaseOutput, CaseVerdict, verdictTone } from "./CaseOutput";
import { CaseBrowserLayout } from "./CaseBrowserLayout";

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
  returnType,
}: {
  cases: PublicCaseResult[];
  sql?: PublishedQuestion["sql"];
  returnType?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, cases.length - 1));
  const selected = cases[activeIndex];
  return (
    <CaseBrowserLayout
      railLabel="Select run result"
      selection={String(activeIndex)}
      status={<CaseVerdict result={selected} />}
      rail={cases.map((result, index) => (
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
    >
      {selected && (
        <CaseOutput result={selected} sql={sql} returnType={returnType} showVerdict={false} />
      )}
    </CaseBrowserLayout>
  );
}

type ResultContentProps = {
  submission?: Submission;
  busy: boolean;
  error?: string;
  showCases?: boolean;
  detailsVisible?: boolean;
  customMode?: boolean;
  runWasCustom?: boolean;
  showVerdict?: boolean;
  sql?: PublishedQuestion["sql"];
  returnType?: string;
};

/** Renders admitted results with a stable, shared recovery notice. */
export function ResultContent(props: ResultContentProps) {
  const { submission, customMode, runWasCustom = false, error, busy } = props;
  // Results belong to their admitted collection, regardless of the currently selected tab.
  if (
    submission &&
    customMode !== undefined &&
    customMode !== (submission.kind === "run" && runWasCustom)
  )
    return null;
  if (error) return null;
  // The case browser owns individual errors; this summary reports only run totals.
  if (
    !busy &&
    submission?.kind === "run" &&
    submission.state === "completed" &&
    props.showCases === false &&
    (props.showVerdict === false ||
      (!submission.score && !submission.publicCases?.some((item) => item.status !== "executed")))
  )
    return null;
  const failed = !busy && submission?.state === "failed";
  const action = submission?.kind === "submit" ? "Submit" : "Run";
  return (
    <NoticeRegion
      label={`${action} failed`}
      message={
        failed
          ? `This execution could not be judged. Your source is safe. ${action} again to retry.`
          : undefined
      }
    >
      <ResultSummary {...props} />
    </NoticeRegion>
  );
}

/** Shows safe compiler and case feedback; infrastructure details stay private. */
function ResultSummary({
  submission,
  busy,
  showCases = true,
  detailsVisible = false,
  showVerdict = true,
  sql,
  returnType,
}: ResultContentProps) {
  if (busy) return <LoadingIndicator label="Starting execution…" immediate />;
  if (!submission)
    return showVerdict ? <p className="result-message">Run your code to see results.</p> : null;
  if (submission.state === "queued" || submission.state === "running")
    return (
      <div className="result-running" role="status">
        <span className="running-marker" aria-hidden="true" />
        <strong>{submission.state === "queued" ? "Queued" : "Running"}</strong>
      </div>
    );
  if (submission.state === "failed") return null;
  if (submission.state === "cancelled") return <p className="result-message">Run cancelled</p>;
  const diagnostics = showCases ? submission.diagnostics : undefined;
  if (!showVerdict && !diagnostics?.length && (!showCases || !submission.publicCases?.length))
    return null;
  const verdict =
    submission.verdict?.replaceAll("_", " ") ??
    (submission.kind === "run" ? "Executed" : "Completed");
  const compared = submission.publicCases?.filter((item) => item.status !== "executed") ?? [];
  const passed = compared.filter((item) => item.status === "accepted").length;
  return (
    <div className="result-complete">
      {(showVerdict || !!diagnostics?.length) && (
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
                <strong>
                  <Icon name={verdictIcon(submission.verdict)} />
                  {verdict}
                </strong>
              )}
            </div>
          )}
          <Diagnostics items={diagnostics} />
        </div>
      )}
      {showCases && submission.publicCases?.length ? (
        <RunCaseResults
          key={submission.id}
          cases={submission.publicCases}
          sql={sql}
          returnType={returnType}
        />
      ) : null}
    </div>
  );
}
