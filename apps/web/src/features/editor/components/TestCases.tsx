import { Tooltip } from "./Tooltip";
import type { ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
import { useState, type ReactNode } from "react";
import {
  associatedResultIndex,
  createCustomDraft,
  parseCustomDraft,
  caseSnapshotValue,
  type CustomCaseDraft,
  type RunSnapshot,
} from "../customCases";
import { bindArguments } from "../argumentBinding";
import { Icon } from "./Icon";
import { TypedCaseInput } from "./TypedCaseInput";
import "./customCases.css";
import { CaseOutput, CaseValue } from "./CaseOutput";
import { SequenceCaseValues } from "./SequenceCaseValues";

export function TestCases({
  problem,
  customMode,
  drafts,
  onDraftsChange,
  submission,
  snapshot,
  selectedSampleIndex,
  busy = false,
  minimumCases = 1,
  requiredExpected = false,
  caseActions,
  caseResults,
}: {
  problem: ProblemVersion;
  customMode: boolean;
  drafts: CustomCaseDraft[];
  onDraftsChange: (drafts: CustomCaseDraft[]) => void;
  submission?: Submission;
  snapshot?: RunSnapshot;
  selectedSampleIndex?: number;
  busy?: boolean;
  minimumCases?: number;
  requiredExpected?: boolean;
  caseActions?: (index: number) => ReactNode;
  caseResults?: readonly (PublicCaseResult | undefined)[];
}) {
  const hiddenCases =
    !caseResults &&
    !busy &&
    !customMode &&
    submission?.kind === "submit" &&
    submission.state === "completed"
      ? submission.hiddenCases
      : undefined;
  const [selectedSample, setSelectedSample] = useState(0);
  const [selectedCustomId, setSelectedCustomId] = useState<string>();
  // Recovered output without an admission snapshot belongs in this same case rail.
  const recoveredCases =
    !caseResults &&
    !busy &&
    !snapshot &&
    !customMode &&
    submission?.kind === "run" &&
    submission.state === "completed"
      ? submission.publicCases
      : undefined;
  const sampleIndex = Math.min(
    selectedSampleIndex ?? selectedSample,
    Math.max(0, (hiddenCases?.length ?? recoveredCases?.length ?? problem.examples.length) - 1),
  );
  const customIndex = Math.max(
    0,
    drafts.findIndex((draft) => draft.id === selectedCustomId),
  );
  const draft = drafts[customIndex];
  const example = problem.examples[sampleIndex];
  let currentValue;
  try {
    currentValue =
      customMode && draft
        ? parseCustomDraft(draft, problem.signature, problem.constraints)
        : example
          ? caseSnapshotValue(example)
          : undefined;
  } catch {
    /* An edited invalid draft cannot inherit a previous result. */
  }
  const caseId = customMode ? draft?.id : String(sampleIndex);
  const matchingSnapshot = snapshot?.problemVersionId === problem.id ? snapshot : undefined;
  const pending =
    (busy || submission?.state === "queued" || submission?.state === "running") &&
    (submission?.kind === "submit" ? !customMode : customMode === !!matchingSnapshot?.custom);
  const runningSamples = pending && submission?.kind !== "submit";
  const resultIndex = caseId
    ? associatedResultIndex(matchingSnapshot, customMode, caseId, currentValue)
    : -1;
  const result =
    (!pending ? caseResults?.[sampleIndex] : undefined) ??
    (!pending && submission?.kind === "run" && submission.state === "completed" && resultIndex >= 0
      ? submission.publicCases?.[resultIndex]
      : recoveredCases?.[sampleIndex]);
  const editedAfterRun =
    customMode &&
    matchingSnapshot?.custom &&
    matchingSnapshot.cases.some((item) => item.id === caseId) &&
    resultIndex < 0;
  function updateDraft(change: Partial<CustomCaseDraft>) {
    onDraftsChange(drafts.map((item) => (item.id === draft?.id ? { ...item, ...change } : item)));
  }
  function caseStatus(index: number) {
    if (pending) return undefined;
    if (caseResults) return caseResults[index]?.status;
    if (hiddenCases) return hiddenCases[index]?.status;
    if (submission?.kind !== "run" || submission.state !== "completed") return undefined;
    if (recoveredCases) return recoveredCases[index]?.status;
    let value;
    try {
      value = customMode
        ? parseCustomDraft(drafts[index]!, problem.signature, problem.constraints)
        : caseSnapshotValue(problem.examples[index]!);
    } catch {
      return undefined;
    }
    const resultIndex = associatedResultIndex(
      matchingSnapshot,
      customMode,
      customMode ? drafts[index]!.id : String(index),
      value,
    );
    return resultIndex >= 0 ? submission.publicCases?.[resultIndex]?.status : undefined;
  }
  const statuses = (customMode ? drafts : (hiddenCases ?? recoveredCases ?? problem.examples)).map(
    (_, index) => caseStatus(index),
  );
  return (
    <div className="case-browser" aria-busy={pending}>
      <div
        className="case-rail"
        aria-label={
          customMode
            ? "Select custom case"
            : hiddenCases
              ? "Select hidden case"
              : "Select sample case"
        }
      >
        {(customMode ? drafts : (hiddenCases ?? recoveredCases ?? problem.examples)).map(
          (item, index) => (
            <button
              type="button"
              key={customMode ? (item as CustomCaseDraft).id : index}
              className="case-selector"
              aria-pressed={index === (customMode ? customIndex : sampleIndex)}
              aria-label={`Case ${index + 1}${runningSamples ? ": pending" : statuses[index] ? `: ${hiddenCases ? (statuses[index] === "accepted" ? "passed" : statuses[index] === "time_limit" ? "time limit exceeded" : "failed") : statuses[index]!.replaceAll("_", " ")}` : ""}`}
              onClick={() =>
                customMode ? setSelectedCustomId(drafts[index]!.id) : setSelectedSample(index)
              }
            >
              {runningSamples && <span className="case-spinner" aria-hidden="true" />}
              {statuses[index] && statuses[index] !== "executed" && (
                <Icon
                  name={hiddenCases ? "lock" : statuses[index] === "accepted" ? "submit" : "close"}
                  className={statuses[index] === "accepted" ? "verdict-success" : "verdict-error"}
                />
              )}
              Case {index + 1}
            </button>
          ),
        )}
        {customMode && (
          <button
            type="button"
            className="case-selector add-case"
            disabled={drafts.length >= 20}
            onClick={() => {
              const added = { ...createCustomDraft(problem), expectedEnabled: requiredExpected };
              onDraftsChange([...drafts, added]);
              setSelectedCustomId(added.id);
            }}
          >
            <Icon name="plus" /> Add case
          </button>
        )}
      </div>
      <div className="case-details">
        {caseActions?.(sampleIndex)}
        {customMode && draft ? (
          <>
            <div className="custom-case-heading">
              <span>Case {customIndex + 1}</span>
              <Tooltip content="Remove case">
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  disabled={drafts.length <= minimumCases}
                  aria-label={`Remove custom case ${customIndex + 1}`}
                  onClick={() => {
                    const remaining = drafts.filter((item) => item.id !== draft.id);
                    onDraftsChange(remaining);
                    setSelectedCustomId(remaining[Math.min(customIndex, remaining.length - 1)]?.id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              </Tooltip>
            </div>
            {problem.signature.parameters.map(({ name, type, input }, index) => (
              <TypedCaseInput
                key={`${draft.id}:${name}`}
                id={`custom-${draft.id}-${index}`}
                name={name}
                type={type}
                input={input}
                value={draft.args[index] ?? ""}
                onChange={(value) =>
                  updateDraft({
                    args: draft.args.map((arg, argIndex) => (argIndex === index ? value : arg)),
                  })
                }
              />
            ))}
            {draft.expectedEnabled ? (
              <div className="expected-field">
                <TypedCaseInput
                  id={`custom-${draft.id}-expected`}
                  name="Expected output"
                  purpose="expected"
                  action={
                    !requiredExpected && (
                      <Tooltip content="Remove expected output">
                        <button
                          type="button"
                          className="icon-button destructive-icon"
                          aria-label="Remove expected output"
                          onClick={() => updateDraft({ expectedEnabled: false })}
                        >
                          <Icon name="trash" />
                        </button>
                      </Tooltip>
                    )
                  }
                  type={problem.signature.returnType}
                  value={draft.expected}
                  onChange={(expected) => updateDraft({ expected })}
                />
              </div>
            ) : (
              <button
                type="button"
                className="quiet-button add-expected"
                onClick={() => updateDraft({ expectedEnabled: true })}
              >
                <Icon name="target" /> Add expected output
              </button>
            )}
          </>
        ) : customMode ? (
          <p className="result-message">Add a case to get started.</p>
        ) : hiddenCases?.length ? (
          <div className="locked-case">
            <Icon
              name="lock"
              className={
                hiddenCases[sampleIndex]?.status === "accepted"
                  ? "verdict-success"
                  : "verdict-error"
              }
            />
            <span>Hidden case {sampleIndex + 1}</span>
            <span
              className={
                hiddenCases[sampleIndex]?.status === "accepted"
                  ? "verdict-success"
                  : "verdict-error"
              }
            >
              {hiddenCases[sampleIndex]?.status === "time_limit" ? "Time limit exceeded" : null}
            </span>
          </div>
        ) : recoveredCases?.length ? null : example?.calls?.length ? (
          <SequenceCaseValues problem={problem} calls={example.calls} />
        ) : example ? (
          <>
            {bindArguments(problem.signature, example.args).map(({ name, value }, index) => (
              <CaseValue key={index} name={name} value={value} parameter />
            ))}
            <CaseValue
              name="Expected output"
              purpose="target"
              value={example.expected}
              tone="verdict-success"
            />
          </>
        ) : (
          <p className="result-message">
            {customMode ? "Add a case to get started." : "No sample cases available."}
          </p>
        )}
        {editedAfterRun && (
          <p className="case-stale">Edited since last run. Run again for this input.</p>
        )}
        {pending && (
          <div className="case-loading" role="status">
            <span className="case-spinner" aria-hidden="true" />
            <span>
              {submission?.state === "running"
                ? submission.kind === "submit"
                  ? "Judging hidden cases…"
                  : "Running cases…"
                : submission?.state === "queued"
                  ? "Waiting for judge…"
                  : "Starting…"}
            </span>
          </div>
        )}
        {result && (
          <CaseOutput
            result={result}
            showExpected={!!recoveredCases?.length || (customMode && !draft?.expectedEnabled)}
          />
        )}
      </div>
    </div>
  );
}
