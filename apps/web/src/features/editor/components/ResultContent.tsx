/** @file ResultContent.tsx @description Renders safe judge status and public case output. @module editor */
import type { ProblemVersion, Submission } from "@quorem/contracts";

/** Shows a bounded execution result without exposing hidden case data. */
export function ResultContent({
  submission,
  busy,
  error,
  problem,
}: {
  submission?: Submission;
  busy: boolean;
  error?: string;
  problem?: ProblemVersion;
}) {
  if (error) return <p className="result-message result-error">{error}</p>;
  if (!submission && busy) return <p className="result-message">Starting a fresh judge job…</p>;
  if (!submission)
    return (
      <div className="result-empty">
        <div className="result-empty-heading">
          <strong>Ready to run.</strong>
          <span>Check the public examples before submitting.</span>
        </div>
        <div className="ready-cases">
          {problem?.examples.map((example, index) => (
            <div key={index}>
              <span className="mono">{String(index + 1).padStart(2, "0")}</span>
              <code>{JSON.stringify(example.args)}</code>
              <span className="expected-label">expected</span>
              <code>{JSON.stringify(example.expected)}</code>
            </div>
          ))}
        </div>
        <p>Submit evaluates the full suite. Hidden inputs remain private.</p>
      </div>
    );
  if (submission.state === "queued" || submission.state === "running") {
    return (
      <div className="result-running" role="status">
        <span className="running-marker" aria-hidden="true" />
        <div>
          <strong>{submission.state === "queued" ? "Queued" : "Running"}</strong>
          <p>Checking source {submission.sourceHash.slice(0, 12)}…</p>
        </div>
      </div>
    );
  }
  if (submission.state === "failed") {
    return (
      <p className="result-message result-error">
        Judge unavailable. Your source is safe. {submission.infrastructureError}
      </p>
    );
  }
  if (submission.state === "cancelled")
    return (
      <p className="result-message">Run cancelled · source {submission.sourceHash.slice(0, 12)}</p>
    );

  const verdict =
    submission.verdict?.replaceAll("_", " ") ??
    (submission.kind === "run" ? "executed" : "completed");
  const positive = submission.verdict === "accepted";
  return (
    <div className="result-complete">
      <div className={`verdict-line ${positive ? "verdict-success" : "verdict-neutral"}`}>
        <span aria-hidden="true">{positive ? "✓" : "•"}</span>
        <strong>{verdict}</strong>
        {submission.score && (
          <span className="score-count">
            {submission.score.passed}/{submission.score.total} passed
          </span>
        )}
        <span className="source-hash">source {submission.sourceHash.slice(0, 12)}</span>
      </div>
      {submission.diagnostics?.length ? (
        <ul className="diagnostic-list">
          {submission.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.line}-${diagnostic.column}-${index}`}>
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
      ) : null}
      {submission.publicCases?.length ? (
        <ol className="case-list" aria-label="Public case results">
          {submission.publicCases.map((result) => (
            <li key={result.index}>
              <span className={`case-mark case-${result.status}`} aria-hidden="true">
                {result.status === "accepted" ? "✓" : "·"}
              </span>
              <span>Case {result.index + 1}</span>
              <code>{result.status.replaceAll("_", " ")}</code>
              {result.actual !== undefined && (
                <code className="case-value">→ {JSON.stringify(result.actual)}</code>
              )}
              {result.status === "wrong_answer" && result.expected !== undefined && (
                <code className="case-value">expected {JSON.stringify(result.expected)}</code>
              )}
              {result.diagnostics?.map((diagnostic, index) => (
                <pre className="case-diagnostic" key={index}>
                  {diagnostic.line != null ? `Line ${diagnostic.line}: ` : ""}
                  {diagnostic.message}
                </pre>
              ))}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
