import type { ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
import { useState } from "react";
import {
  associatedResultIndex,
  createCustomDraft,
  parseCustomDraft,
  type CustomCaseDraft,
  type RunSnapshot,
} from "../customCases";
import { TypedCaseInput } from "./TypedCaseInput";
import "./customCases.css";

function CaseOutput({ result }: { result: PublicCaseResult }) {
  return (
    <div className="case-run-output">
      <span className={`case-verdict ${result.status === "accepted" ? "verdict-success" : ""}`}>
        {result.status.replaceAll("_", " ")}
      </span>
      {result.actual !== undefined && (
        <div className="case-detail">
          <span>Output</span>
          <code>{JSON.stringify(result.actual)}</code>
        </div>
      )}
      {result.expected !== undefined && (
        <div className="case-detail">
          <span>Expected output from run</span>
          <code>{JSON.stringify(result.expected)}</code>
        </div>
      )}
      {result.diagnostics?.map((item, index) => (
        <p className="typed-case-error" key={index}>
          {item.line ? `Line ${item.line}: ` : ""}
          {item.message}
        </p>
      ))}
    </div>
  );
}

export function TestCases({
  problem,
  customMode,
  drafts,
  onDraftsChange,
  submission,
  snapshot,
}: {
  problem: ProblemVersion;
  customMode: boolean;
  drafts: CustomCaseDraft[];
  onDraftsChange: (drafts: CustomCaseDraft[]) => void;
  submission?: Submission;
  snapshot?: RunSnapshot;
}) {
  const [selectedSample, setSelectedSample] = useState(0);
  const [selectedCustomId, setSelectedCustomId] = useState<string>();
  const sampleIndex = Math.min(selectedSample, Math.max(0, problem.examples.length - 1));
  const customIndex = Math.max(
    0,
    drafts.findIndex((draft) => draft.id === selectedCustomId),
  );
  const draft = drafts[customIndex];
  const example = problem.examples[sampleIndex];
  let currentValue;
  try {
    currentValue = customMode && draft ? parseCustomDraft(draft, problem.signature) : example;
  } catch {
    /* An edited invalid draft cannot inherit a previous result. */
  }
  const caseId = customMode ? draft?.id : String(sampleIndex);
  const matchingSnapshot = snapshot?.problemVersionId === problem.id ? snapshot : undefined;
  const resultIndex = caseId
    ? associatedResultIndex(matchingSnapshot, customMode, caseId, currentValue)
    : -1;
  const result =
    submission?.kind === "run" && submission.state === "completed" && resultIndex >= 0
      ? submission.publicCases?.[resultIndex]
      : undefined;
  const editedAfterRun =
    customMode &&
    matchingSnapshot?.custom &&
    matchingSnapshot.cases.some((item) => item.id === caseId) &&
    resultIndex < 0;
  function updateDraft(change: Partial<CustomCaseDraft>) {
    onDraftsChange(drafts.map((item) => (item.id === draft?.id ? { ...item, ...change } : item)));
  }
  return (
    <div className="case-browser">
      <div
        className="case-rail"
        aria-label={customMode ? "Select custom case" : "Select sample case"}
      >
        {(customMode ? drafts : problem.examples).map((item, index) => (
          <button
            key={customMode ? (item as CustomCaseDraft).id : index}
            className="case-selector"
            aria-pressed={index === (customMode ? customIndex : sampleIndex)}
            onClick={() =>
              customMode ? setSelectedCustomId(drafts[index]!.id) : setSelectedSample(index)
            }
          >
            Case {index + 1}
          </button>
        ))}
        {customMode && (
          <button
            className="case-selector add-case"
            disabled={drafts.length >= 20}
            onClick={() => {
              const added = createCustomDraft(problem);
              onDraftsChange([...drafts, added]);
              setSelectedCustomId(added.id);
            }}
          >
            + Add case
          </button>
        )}
      </div>
      <div className="case-details">
        {customMode && draft ? (
          <>
            <div className="custom-case-heading">
              <span>Case {customIndex + 1}</span>
              <button
                className="quiet-button"
                disabled={drafts.length === 1}
                aria-label={`Remove custom case ${customIndex + 1}`}
                onClick={() => {
                  const remaining = drafts.filter((item) => item.id !== draft.id);
                  onDraftsChange(remaining);
                  setSelectedCustomId(remaining[Math.min(customIndex, remaining.length - 1)]?.id);
                }}
              >
                Remove
              </button>
            </div>
            {problem.signature.parameters.map(({ name, type }, index) => (
              <TypedCaseInput
                key={`${draft.id}:${name}`}
                id={`custom-${draft.id}-${index}`}
                name={name}
                type={type}
                value={draft.args[index] ?? ""}
                onChange={(value) =>
                  updateDraft({
                    args: draft.args.map((arg, argIndex) => (argIndex === index ? value : arg)),
                  })
                }
              />
            ))}
            <label className="expected-toggle">
              <input
                type="checkbox"
                checked={draft.expectedEnabled}
                onChange={(event) => updateDraft({ expectedEnabled: event.target.checked })}
              />
              Compare expected output
            </label>
            {draft.expectedEnabled && (
              <TypedCaseInput
                id={`custom-${draft.id}-expected`}
                name="Expected output"
                type={problem.signature.returnType}
                value={draft.expected}
                onChange={(expected) => updateDraft({ expected })}
              />
            )}
          </>
        ) : example ? (
          <>
            {example.args.map((value, index) => (
              <div className="case-detail" key={index}>
                <span>{problem.signature.parameters[index]?.name ?? `arg${index + 1}`}</span>
                <code>{JSON.stringify(value)}</code>
              </div>
            ))}
            <div className="case-detail">
              <span>Expected output</span>
              <code>{JSON.stringify(example.expected)}</code>
            </div>
          </>
        ) : (
          <p className="result-message">No sample cases available.</p>
        )}
        {editedAfterRun && (
          <p className="case-stale">Edited since last run. Run again for this input.</p>
        )}
        {result && <CaseOutput result={result} />}
      </div>
    </div>
  );
}
