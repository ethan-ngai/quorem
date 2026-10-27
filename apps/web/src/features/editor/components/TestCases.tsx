import { CaseBrowserLayout } from "./CaseBrowserLayout";
import { Tooltip } from "../../../ui/Tooltip";
import type { ProblemVersion, PublicCaseResult, Submission } from "@quorem/contracts";
import { useEffect, useState, type ReactNode } from "react";
import {
  associatedResultIndex,
  createCustomDraft,
  parseProblemDraft,
  caseSnapshotValue,
  type CustomCaseDraft,
  type RunSnapshot,
} from "../customCases";
import { bindArguments } from "../argumentBinding";
import { Icon } from "../../../ui/Icon";
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
  maximumCases = 20,
  requiredExpected = false,
  caseActions,
  caseResults,
  caseStatuses,
  caseGroups,
  currentCaseGroup,
  selectedCustomId,
  onSelectCustomCase,
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
  maximumCases?: number;
  requiredExpected?: boolean;
  caseActions?: (index: number) => ReactNode;
  caseGroups?: readonly (string | undefined)[];
  currentCaseGroup?: string;
  selectedCustomId?: string;
  onSelectCustomCase?: (id: string | undefined) => void;
  caseResults?: readonly (PublicCaseResult | undefined)[];
  caseStatuses?: readonly PublicCaseResult[];
}) {
  const hiddenCases =
    !customMode &&
    !caseResults &&
    !busy &&
    submission?.kind === "submit" &&
    submission.state === "completed"
      ? submission.hiddenCases
      : undefined;
  const [selectedHidden, setSelectedHidden] = useState<number>();
  useEffect(() => {
    setSelectedHidden(undefined);
  }, [submission?.id, busy]);
  const showingHidden = selectedHidden !== undefined && !!hiddenCases?.[selectedHidden];
  const currentGroupStart = Math.max(0, caseGroups?.indexOf(currentCaseGroup) ?? 0);
  const [selectedSample, setSelectedSample] = useState(currentGroupStart);
  useEffect(() => {
    if (currentCaseGroup) setSelectedSample(currentGroupStart);
  }, [currentCaseGroup, currentGroupStart]);
  const [requestedCustomId, setRequestedCustomId] = useState<string>();
  function setSelectedCustomId(id: string | undefined) {
    setRequestedCustomId(id);
    onSelectCustomCase?.(id);
  }
  // Recovered output without an admission snapshot belongs in this same case rail.
  const recoveredCases =
    !caseResults &&
    !busy &&
    !submission?.customRun &&
    (!snapshot || submission?.kind === "submit" || !!problem.odyssey) &&
    !customMode &&
    (submission?.kind === "run" || submission?.kind === "submit") &&
    submission.state === "completed"
      ? submission.publicCases
      : undefined;
  // Unlocked samples outlive a submission; hidden verdicts are a different indexed suite.
  const displayCases =
    (submission?.kind === "submit" || problem.odyssey ? undefined : recoveredCases) ??
    problem.examples;
  const sampleIndex = Math.min(
    selectedSampleIndex ?? selectedSample,
    Math.max(0, displayCases.length - 1),
  );
  const customIndex = Math.max(
    0,
    drafts.findIndex((draft) => draft.id === (selectedCustomId ?? requestedCustomId)),
  );
  const draft = drafts[customIndex];
  const example = problem.examples[sampleIndex];
  let currentValue;
  try {
    currentValue =
      customMode && draft
        ? parseProblemDraft(draft, problem)
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
    const retained = caseStatuses?.find((result) => result.index === index)?.status;
    if (pending)
      return currentCaseGroup && caseGroups?.[index] !== currentCaseGroup ? retained : undefined;
    if (caseResults) return caseResults[index]?.status ?? retained;
    if (!submission || submission.state !== "completed") return retained;
    if (submission.kind === "submit") return recoveredCases?.[index]?.status ?? retained;
    if (recoveredCases) return recoveredCases[index]?.status ?? retained;
    let value;
    try {
      value = customMode
        ? parseProblemDraft(drafts[index]!, problem)
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
  const statuses = (customMode ? drafts : displayCases).map((_, index) => caseStatus(index));
  const items = customMode ? drafts : displayCases;
  const groups = [...new Set(caseGroups?.filter((group): group is string => !!group))];
  function caseButton(index: number) {
    const item = items[index]!;
    const runningCase =
      runningSamples && (!currentCaseGroup || caseGroups?.[index] === currentCaseGroup);
    return (
      <button
        type="button"
        key={customMode ? (item as CustomCaseDraft).id : index}
        className="case-selector"
        aria-pressed={!showingHidden && index === (customMode ? customIndex : sampleIndex)}
        aria-label={`Case ${index + 1}${runningCase ? ": pending" : statuses[index] ? `: ${statuses[index]!.replaceAll("_", " ")}` : ""}`}
        onClick={() => {
          setSelectedHidden(undefined);
          if (customMode) setSelectedCustomId(drafts[index]!.id);
          else setSelectedSample(index);
        }}
      >
        {runningCase && <span className="case-spinner" aria-hidden="true" />}
        {statuses[index] && statuses[index] !== "executed" && (
          <Icon
            name={statuses[index] === "accepted" ? "submit" : "close"}
            className={statuses[index] === "accepted" ? "verdict-success" : "verdict-error"}
          />
        )}
        Case {index + 1}
      </button>
    );
  }
  return (
    <CaseBrowserLayout
      busy={pending}
      railLabel={customMode ? "Select custom case" : "Select test case"}
      rail={
        <>
          {!customMode && groups.length
            ? groups.map((group, groupIndex) => {
                const indexes = items.flatMap((_, index) =>
                  caseGroups?.[index] === group ? [index] : [],
                );
                const previous =
                  !!currentCaseGroup && groupIndex < groups.indexOf(currentCaseGroup);
                const failed = indexes.some(
                  (index) =>
                    statuses[index] && !["accepted", "executed"].includes(statuses[index]!),
                );
                const passed =
                  indexes.length > 0 && indexes.every((index) => statuses[index] === "accepted");
                const buttons = indexes.map(caseButton);
                return previous ? (
                  <CaseGroupDisclosure
                    key={group}
                    label={group}
                    failed={failed}
                    passed={passed}
                    executionID={submission?.id}
                  >
                    {buttons}
                  </CaseGroupDisclosure>
                ) : (
                  <div className="case-group" key={group}>
                    <div className="case-group-label">
                      {group}
                      <CaseGroupStatus failed={failed} passed={passed} />
                    </div>
                    {buttons}
                  </div>
                );
              })
            : items.map((_, index) => caseButton(index))}
          {!!hiddenCases?.length && (
            <CaseGroupDisclosure
              label="Hidden"
              icon="lock"
              executionID={submission?.id}
              failed={hiddenCases.some((item) => item.status !== "accepted")}
              passed={hiddenCases.every((item) => item.status === "accepted")}
              onClose={() => setSelectedHidden(undefined)}
            >
              {hiddenCases.map((item, index) => (
                <button
                  type="button"
                  key={index}
                  className="case-selector"
                  aria-pressed={showingHidden && selectedHidden === index}
                  aria-label={`Hidden case ${index + 1}: ${item.status === "accepted" ? "passed" : item.status === "time_limit" ? "time limit exceeded" : "failed"}`}
                  onClick={() => setSelectedHidden(index)}
                >
                  <Icon
                    name={item.status === "accepted" ? "submit" : "close"}
                    className={item.status === "accepted" ? "verdict-success" : "verdict-error"}
                  />
                  Case {index + 1}
                </button>
              ))}
            </CaseGroupDisclosure>
          )}
          {customMode && (
            <button
              type="button"
              className="case-selector add-case"
              disabled={drafts.length >= maximumCases}
              onClick={() => {
                const added = { ...createCustomDraft(problem), expectedEnabled: requiredExpected };
                onDraftsChange([...drafts, added]);
                setSelectedCustomId(added.id);
              }}
            >
              <Icon name="plus" /> Add case
            </button>
          )}
        </>
      }
    >
      {!showingHidden && caseActions?.(sampleIndex)}
      {showingHidden && hiddenCases ? (
        <div className="locked-case">
          <Icon
            name="lock"
            className={
              hiddenCases[selectedHidden]!.status === "accepted"
                ? "verdict-success"
                : "verdict-error"
            }
          />
          <span>Hidden case {selectedHidden + 1}</span>
          <span
            className={
              hiddenCases[selectedHidden]!.status === "accepted"
                ? "verdict-success"
                : "verdict-error"
            }
          >
            {hiddenCases[selectedHidden]!.status === "time_limit" ? "Time limit exceeded" : null}
          </span>
        </div>
      ) : customMode && draft ? (
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
          {problem.sql || problem.odyssey ? (
            <div className="typed-case-field">
              <label htmlFor={`custom-${draft.id}-structured`}>
                {problem.sql ? "Tables (JSON)" : "Calls (JSON)"}
              </label>
              <textarea
                id={`custom-${draft.id}-structured`}
                className="typed-input"
                rows={8}
                value={draft.args[0] ?? ""}
                onChange={(event) => updateDraft({ args: [event.target.value] })}
              />
              {problem.sql && currentValue && (
                <CaseValue name="Tables" value={currentValue.args[0]} parameter sql={problem.sql} />
              )}
              {problem.odyssey && !problem.sql && currentValue?.calls && (
                <SequenceCaseValues problem={problem} calls={currentValue.calls} />
              )}
            </div>
          ) : (
            problem.signature.parameters.map(({ name, type, input }, index) => (
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
            ))
          )}
          {(!problem.odyssey || problem.sql) &&
            (draft.expectedEnabled ? (
              <div className="expected-field">
                {problem.sql ? (
                  <div className="typed-case-field">
                    <label htmlFor={`custom-${draft.id}-expected`}>Expected output (JSON)</label>
                    <textarea
                      id={`custom-${draft.id}-expected`}
                      className="typed-input"
                      rows={4}
                      value={draft.expected}
                      onChange={(event) => updateDraft({ expected: event.target.value })}
                    />
                    {currentValue?.expected !== undefined && (
                      <CaseValue
                        name="Expected output"
                        purpose="target"
                        value={currentValue.expected}
                        sql={problem.sql}
                      />
                    )}
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => updateDraft({ expectedEnabled: false })}
                    >
                      Remove expected output
                    </button>
                  </div>
                ) : (
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
                )}
              </div>
            ) : (
              <button
                type="button"
                className="quiet-button add-expected"
                onClick={() => updateDraft({ expectedEnabled: true })}
              >
                <Icon name="target" /> Add expected output
              </button>
            ))}
        </>
      ) : customMode ? (
        <p className="result-message">Add a case to get started.</p>
      ) : recoveredCases?.[sampleIndex] ? null : example?.calls?.length ? (
        !result && <SequenceCaseValues problem={problem} calls={example.calls} />
      ) : example ? (
        <>
          <div className="case-call-inputs">
            {(problem.sql
              ? [{ name: "Tables", value: example.args[0] }]
              : bindArguments(problem.signature, example.args)
            ).map(({ name, value }, index) => (
              <CaseValue key={index} name={name} value={value} parameter sql={problem.sql} />
            ))}
          </div>
          <CaseValue
            name="Expected output"
            purpose="target"
            value={example.expected}
            tone="verdict-success"
            sql={problem.sql}
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
      {!showingHidden &&
        !pending &&
        !result &&
        submission?.state === "completed" &&
        submission.verdict === "syntax_error" && (
          <CaseOutput
            result={{
              index: sampleIndex,
              status: "syntax_error",
              diagnostics: submission.diagnostics,
            }}
          />
        )}
      {!showingHidden && result && (
        <CaseOutput
          result={result}
          sql={problem.sql}
          sequence={
            example?.calls?.length
              ? {
                  calls: example.calls,
                  methods: problem.odyssey?.levels.flatMap((level) => level.methods) ?? [
                    problem.signature,
                  ],
                }
              : undefined
          }
          showExpected={
            !!example?.calls?.length ||
            !!recoveredCases?.length ||
            (customMode && !draft?.expectedEnabled)
          }
        />
      )}
    </CaseBrowserLayout>
  );
}

/** A new failing execution reveals regressions, while retaining manual disclosure control. */
function CaseGroupDisclosure({
  label,
  failed,
  passed,
  executionID,
  icon,
  onClose,
  children,
}: {
  label: string;
  icon?: "lock";
  onClose?: () => void;
  failed: boolean;
  passed: boolean;
  executionID?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(failed);
  useEffect(() => {
    if (failed) setOpen(true);
    else if (passed) setOpen(false);
  }, [failed, passed, executionID]);
  return (
    <details
      className="case-group"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (!next) onClose?.();
      }}
    >
      <summary className={`case-group-label${icon ? " case-group-label--locked" : ""}`}>
        {icon && <Icon name={icon} />}
        <span>{label}</span>
        {icon && <span className="sr-only"> tests</span>}
        <CaseGroupStatus failed={failed} passed={passed} />
        {icon && <Icon name="chevron" className="case-group-chevron" />}
      </summary>
      {children}
    </details>
  );
}

/** Shared verdict for current and previous case groups. */
function CaseGroupStatus({ failed, passed }: { failed: boolean; passed: boolean }) {
  return (
    <>
      {(failed || passed) && (
        <Icon
          name={failed ? "close" : "submit"}
          className={failed ? "verdict-error" : "verdict-success"}
        />
      )}
      <span className="sr-only">{failed ? ": failing" : passed ? ": passed" : ""}</span>
    </>
  );
}
