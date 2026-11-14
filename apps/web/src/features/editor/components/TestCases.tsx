import { caseGraphTargets, inferCaseGraph } from "@quorem/questions";
import { primarySignature } from "@quorem/questions";
import { PersistentNotice } from "../../../ui/PersistentNotice";
import { ConstraintViolation } from "../constraintViolation";
import { CasePreviewLayout, NodeReferenceScope } from "./NodePreview";
import { CaseFields } from "./CaseFields";
import { CaseBrowserLayout } from "./CaseBrowserLayout";
import { Tooltip } from "../../../ui/Tooltip";
import type { QuestionProblem, PublicCaseResult, Submission } from "@quorem/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  associatedResultIndex,
  createCustomDraft,
  parseProblemDraft,
  caseSnapshotValue,
  type CustomCaseDraft,
  type RunSnapshot,
} from "../customCases";
import { Icon } from "../../../ui/Icon";
import "./customCases.css";
import { CaseArguments, CaseOutput, CaseValue, CaseVerdict } from "./CaseOutput";
import { SequenceCaseValues } from "./SequenceCaseValues";
import { SqlCaseEditor } from "./SqlCaseEditor";

export type HiddenCaseDetails = {
  example?: QuestionProblem["examples"][number];
  result?: PublicCaseResult;
  action?: ReactNode;
};

export function TestCases({
  problem,
  customMode,
  drafts,
  onDraftsChange,
  submission,
  snapshot,
  selectedSampleIndex,
  busy = false,
  pendingKind,
  hiddenCaseCount,
  minimumCases = 1,
  maximumCases = 20,
  requiredExpected = false,
  caseActions,
  customCaseDetails,
  renderCaseField,
  caseResults,
  caseStatuses,
  hiddenCaseDetails,
  caseGroups,
  currentCaseGroup,
  selectedCustomId,
  onSelectCustomCase,
}: {
  problem: QuestionProblem;
  customMode: boolean;
  drafts: CustomCaseDraft[];
  onDraftsChange: (drafts: CustomCaseDraft[]) => void;
  submission?: Submission;
  snapshot?: RunSnapshot;
  selectedSampleIndex?: number;
  busy?: boolean;
  pendingKind?: Submission["kind"];
  hiddenCaseCount?: number;
  minimumCases?: number;
  maximumCases?: number;
  requiredExpected?: boolean;
  caseActions?: (index: number) => ReactNode;
  renderCaseField?: (index: number, name: string, field: ReactNode) => ReactNode;
  customCaseDetails?: (index: number) => ReactNode;
  caseGroups?: readonly (string | undefined)[];
  currentCaseGroup?: string;
  selectedCustomId?: string;
  onSelectCustomCase?: (id: string | undefined) => void;
  caseResults?: readonly (PublicCaseResult | undefined)[];
  caseStatuses?: readonly PublicCaseResult[];
  hiddenCaseDetails?: (index: number) => HiddenCaseDetails | undefined;
}) {
  const browseSubmission = !customMode && !caseResults && !busy && !submission?.customRun;
  const submit = browseSubmission && submission?.kind === "submit" ? submission : undefined;
  const liveSubmit = submit?.state === "running";
  const submitFeedback = submit?.state === "completed" || liveSubmit ? submit : undefined;
  const hiddenCases = submitFeedback?.hiddenCases;
  const hiddenVerdicts = new Map(hiddenCases?.map((item) => [item.index, item]));
  const submitSamples = new Map(submitFeedback?.publicCases?.map((item) => [item.index, item]));
  const kind = pendingKind ?? submission?.kind;
  const pendingSubmit =
    !customMode &&
    !caseResults &&
    kind === "submit" &&
    (busy || submission?.state === "queued" || submission?.state === "running");
  const hiddenIndexes =
    pendingSubmit && hiddenCaseCount !== undefined
      ? Array.from({ length: hiddenCaseCount }, (_, index) => index)
      : [...hiddenVerdicts.keys()];
  const [selectedHidden, setSelectedHidden] = useState<number>();
  const previousSubmissionId = useRef(submission?.id);
  useEffect(() => {
    if (busy) setSelectedHidden(undefined);
  }, [busy]);
  useEffect(() => {
    if (
      previousSubmissionId.current &&
      submission?.id &&
      previousSubmissionId.current !== submission.id
    )
      setSelectedHidden(undefined);
    previousSubmissionId.current = submission?.id;
  }, [submission?.id]);
  const activeHidden =
    selectedHidden !== undefined && hiddenIndexes.includes(selectedHidden)
      ? selectedHidden
      : !customMode && !problem.examples.length
        ? hiddenIndexes[0]
        : undefined;
  const showingHidden = activeHidden !== undefined;
  const hidden = showingHidden ? hiddenVerdicts.get(activeHidden) : undefined;
  const revealed = hidden && !pendingSubmit ? hiddenCaseDetails?.(hidden.index) : undefined;
  const hiddenSelector = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (revealed?.example) hiddenSelector.current?.focus({ preventScroll: true });
  }, [revealed?.example]);
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
    browseSubmission &&
    (!snapshot || !!problem.odyssey) &&
    submission?.kind === "run" &&
    submission.state === "completed"
      ? submission.publicCases
      : undefined;
  // Unlocked samples outlive a submission; hidden verdicts are a different indexed suite.
  const displayCases = (!problem.odyssey ? recoveredCases : undefined) ?? problem.examples;
  const sampleIndex = Math.min(
    selectedSampleIndex ?? selectedSample,
    Math.max(0, displayCases.length - 1),
  );
  const customIndex = Math.max(
    0,
    drafts.findIndex((draft) => draft.id === (selectedCustomId ?? requestedCustomId)),
  );
  const draft = drafts[customIndex];
  const example = showingHidden ? revealed?.example : problem.examples[sampleIndex];
  let currentValue;
  let currentError: Error | undefined;
  try {
    currentValue =
      customMode && draft
        ? parseProblemDraft(draft, problem)
        : example
          ? caseSnapshotValue(example)
          : undefined;
  } catch (cause) {
    currentError = cause instanceof Error ? cause : new Error(String(cause));
    /* An edited invalid draft cannot inherit a previous result. */
  }
  const errorFields =
    currentError instanceof ConstraintViolation
      ? [...currentError.parameters]
      : problem.sql
        ? []
        : primarySignature(problem)
            .parameters.filter(({ name }) => currentError?.message.startsWith(`${name}:`))
            .map(({ name }) => name);
  if (currentError?.message.startsWith("Expected output:")) errorFields.push("Expected output");
  const inputErrors = currentError
    ? Object.fromEntries(errorFields.map((name) => [name, currentError.message]))
    : undefined;
  const expectedExample = example && example.expected !== undefined && (
    <CaseValue
      name="Expected output"
      purpose="target"
      nodeContext={
        problem.sql ? undefined : { signature: primarySignature(problem), args: example.args }
      }
      value={example.expected}
      type={problem.sql ? undefined : primarySignature(problem).returnType}
      tone="verdict-success"
      sql={problem.sql}
    />
  );
  const caseId = showingHidden
    ? `hidden:${activeHidden}`
    : customMode
      ? draft?.id
      : String(sampleIndex);
  const matchingSnapshot = snapshot?.problemVersionId === problem.id ? snapshot : undefined;
  const pending =
    (busy || submission?.state === "queued" || submission?.state === "running") &&
    (kind === "submit" ? !customMode : customMode === !!matchingSnapshot?.custom);
  const runningSamples = pending && kind !== "submit";
  const resultIndex = caseId
    ? associatedResultIndex(matchingSnapshot, customMode, caseId, currentValue)
    : -1;
  const runCases = new Map(
    submission?.kind === "run" ? submission.publicCases?.map((item) => [item.index, item]) : [],
  );
  const runResult = runCases.get(resultIndex) ?? recoveredCases?.[sampleIndex];
  const result = showingHidden
    ? revealed?.result
    : ((!pending ? caseResults?.[customMode ? customIndex : sampleIndex] : undefined) ??
      submitSamples.get(sampleIndex) ??
      runResult);
  const syntaxResult: PublicCaseResult | undefined =
    !pending &&
    !result &&
    submission?.state === "completed" &&
    submission.verdict === "syntax_error" &&
    (submission.kind === "run" && snapshot
      ? resultIndex >= 0
      : !customMode && !submission.customRun)
      ? { index: sampleIndex, status: "syntax_error", diagnostics: submission.diagnostics }
      : undefined;
  let graphs = customMode ? undefined : example?.graphs;
  if (!customMode && currentValue && !problem.sql && !problem.odyssey) {
    const signature = primarySignature(problem);
    for (const target of caseGraphTargets(signature, currentValue.expected, graphs)) {
      if (Object.hasOwn(graphs ?? {}, target)) continue;
      const graph = inferCaseGraph(
        signature,
        target,
        currentValue.args,
        currentValue.expected,
        problem.limits.maxCollectionElements,
      );
      if (graph) graphs = { ...graphs, [target]: graph };
    }
  }
  const combinedPreview = !problem.sql && !problem.odyssey;
  const previewContext = problem.sql
    ? undefined
    : {
        signature: primarySignature(problem),
        ...(customMode ? { sources: draft?.args } : { args: currentValue?.args }),
      };
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
    if (pendingSubmit && submitSamples.has(index)) return submitSamples.get(index)?.status;
    if (pending && currentCaseGroup && caseGroups?.[index] !== currentCaseGroup) return retained;
    if (!pending && caseResults) return caseResults[index]?.status ?? retained;
    if (submission?.kind === "submit")
      return pending ? undefined : (submitSamples.get(index)?.status ?? retained);
    const previous = pending ? undefined : retained;
    if (!runCases.size) return previous;
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
    return runCases.get(resultIndex)?.status ?? previous;
  }
  const statuses = (customMode ? drafts : displayCases).map((_, index) => caseStatus(index));
  const items = customMode ? drafts : displayCases;
  const groups = [...new Set(caseGroups?.filter((group): group is string => !!group))];
  function casePending(index: number) {
    return (
      (pendingSubmit && !submitSamples.has(index) && !statuses[index]) ||
      (runningSamples &&
        !statuses[index] &&
        (!currentCaseGroup || caseGroups?.[index] === currentCaseGroup))
    );
  }
  function caseButton(index: number) {
    const item = items[index]!;
    const runningCase = casePending(index);
    return (
      <button
        type="button"
        key={customMode ? (item as CustomCaseDraft).id : index}
        className="quiet-button selection-feedback case-selector"
        aria-pressed={!showingHidden && index === (customMode ? customIndex : sampleIndex)}
        aria-label={`Case ${index + 1}${runningCase ? ": pending" : statuses[index] ? `: ${statuses[index]!.replaceAll("_", " ")}` : ""}`}
        onClick={() => {
          setSelectedHidden(undefined);
          if (customMode) setSelectedCustomId(drafts[index]!.id);
          else setSelectedSample(index);
        }}
      >
        <CaseIndicator pending={runningCase} status={statuses[index]} />
        Case {index + 1}
      </button>
    );
  }
  return (
    <CaseBrowserLayout
      busy={pending}
      actions={
        !showingHidden && customMode && draft ? (
          <>
            {currentError && (
              <PersistentNotice
                label={`Check case ${customIndex + 1}`}
                message={currentError.message}
              />
            )}
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
          </>
        ) : undefined
      }
      status={
        <CaseVerdict
          result={result ?? hidden ?? syntaxResult}
          pending={
            showingHidden
              ? pendingSubmit && !hidden
              : casePending(customMode ? customIndex : sampleIndex)
          }
        />
      }
      selection={`${customMode}:${caseId}:${!!revealed?.example}`}
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
          {!!hiddenIndexes.length && (
            <CaseGroupDisclosure
              label="Hidden"
              icon="lock"
              executionID={submission?.id}
              pending={pendingSubmit}
              failed={hiddenCases?.some((item) => item.status !== "accepted") ?? false}
              passed={!pendingSubmit && !!hiddenCases?.every((item) => item.status === "accepted")}
              collapseOnPass={false}
              onClose={() => setSelectedHidden(undefined)}
            >
              {hiddenIndexes.map((index) => {
                const status = hiddenVerdicts.get(index)?.status;
                return (
                  <button
                    type="button"
                    key={index}
                    ref={activeHidden === index ? hiddenSelector : undefined}
                    className="quiet-button selection-feedback case-selector"
                    aria-pressed={activeHidden === index}
                    aria-label={`Hidden case ${index + 1}: ${status === "accepted" ? "passed" : (status?.replaceAll("_", " ") ?? "pending")}`}
                    onClick={() => setSelectedHidden(index)}
                  >
                    <CaseIndicator pending={!status} status={status} />
                    Case {index + 1}
                  </button>
                );
              })}
            </CaseGroupDisclosure>
          )}
          {customMode && (
            <button
              type="button"
              className="quiet-button selection-feedback case-selector add-case"
              disabled={drafts.length >= maximumCases}
              onClick={() => {
                const added = {
                  ...createCustomDraft(problem),
                  expectedEnabled: requiredExpected,
                };
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
      <NodeReferenceScope key={caseId}>
        <CasePreviewLayout
          enabled={combinedPreview}
          editable={customMode}
          context={previewContext}
          graphs={graphs}
          expected={result?.expected ?? currentValue?.expected}
          actual={result?.actual}
          expectedSource={customMode && draft?.expectedEnabled ? draft.expected : undefined}
        >
          {!showingHidden && caseActions?.(sampleIndex)}
          {showingHidden && !example ? (
            <div className="locked-case">
              <Icon name="lock" />
              <span>Hidden case {activeHidden + 1}</span>
              {revealed?.action}
            </div>
          ) : customMode && draft ? (
            <>
              {problem.sql ? (
                <SqlCaseEditor
                  problem={problem}
                  input={draft.args[0] ?? ""}
                  expected={draft.expectedEnabled ? draft.expected : undefined}
                  onInputChange={(value) => updateDraft({ args: [value] })}
                  onExpectedChange={(expected) => updateDraft({ expected })}
                />
              ) : problem.odyssey ? (
                <div className="typed-case-field">
                  <label htmlFor={`custom-${draft.id}-structured`}>Calls (JSON)</label>
                  <textarea
                    id={`custom-${draft.id}-structured`}
                    className="typed-input"
                    rows={8}
                    value={draft.args[0] ?? ""}
                    onChange={(event) => updateDraft({ args: [event.target.value] })}
                  />
                  {problem.odyssey && currentValue?.calls && (
                    <SequenceCaseValues problem={problem} calls={currentValue.calls} />
                  )}
                </div>
              ) : (
                <CaseFields
                  id={`custom-${draft.id}`}
                  signature={primarySignature(problem)}
                  inputErrors={inputErrors}
                  args={draft.args}
                  renderField={
                    renderCaseField && ((name, field) => renderCaseField(customIndex, name, field))
                  }
                  expected={draft.expectedEnabled ? draft.expected : undefined}
                  onChange={updateDraft}
                  preview={!combinedPreview && !result}
                  expectedAction={
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
                >
                  {!draft.expectedEnabled && (
                    <button
                      type="button"
                      className="quiet-button add-expected"
                      onClick={() => updateDraft({ expectedEnabled: true })}
                    >
                      <Icon name="target" /> Add expected output
                    </button>
                  )}
                </CaseFields>
              )}
              {problem.sql &&
                (draft.expectedEnabled ? (
                  <div className="expected-field">
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => updateDraft({ expectedEnabled: false })}
                    >
                      Remove expected output
                    </button>
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
              {customCaseDetails?.(customIndex)}
            </>
          ) : customMode ? (
            <p className="result-message">Add a case to get started.</p>
          ) : !showingHidden && recoveredCases?.[sampleIndex] ? null : example?.calls?.length ? (
            !result && <SequenceCaseValues problem={problem} calls={example.calls} />
          ) : example ? (
            <>
              {problem.sql ? (
                <>
                  <div className="case-call-inputs">
                    <CaseValue name="Tables" value={example.args[0]} parameter sql={problem.sql} />
                  </div>
                  {expectedExample}
                </>
              ) : (
                <CaseArguments
                  signature={primarySignature(problem)}
                  args={example.args}
                  expected={example.expected}
                  preview={!combinedPreview && !result}
                >
                  {expectedExample}
                </CaseArguments>
              )}
            </>
          ) : (
            <p className="result-message">
              {customMode ? "Add a case to get started." : "No sample cases available."}
            </p>
          )}
          {editedAfterRun && (
            <p className="case-stale">Edited since last run. Run again for this input.</p>
          )}
          {result && (
            <CaseOutput
              result={result}
              showVerdict={false}
              preview={!combinedPreview}
              returnType={problem.sql ? undefined : primarySignature(problem).returnType}
              nodeContext={
                problem.sql
                  ? undefined
                  : { signature: primarySignature(problem), args: currentValue?.args }
              }
              sql={problem.sql}
              sequence={
                example?.calls?.length
                  ? {
                      calls: example.calls,
                      methods: problem.odyssey?.levels.flatMap((level) => level.methods) ?? [
                        primarySignature(problem),
                      ],
                    }
                  : undefined
              }
              showExpected={
                !!example?.calls?.length ||
                !!recoveredCases?.length ||
                (!customMode && example?.expected === undefined) ||
                (customMode && !draft?.expectedEnabled)
              }
            />
          )}
        </CasePreviewLayout>
      </NodeReferenceScope>
    </CaseBrowserLayout>
  );
}

/** A new failing execution reveals regressions, while retaining manual disclosure control. */
function CaseGroupDisclosure({
  label,
  failed,
  passed,
  executionID,
  collapseOnPass = true,
  pending = false,
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
  collapseOnPass?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!collapseOnPass || failed || pending);
  useEffect(() => {
    if (failed || pending) setOpen(true);
    else if (passed && collapseOnPass) setOpen(false);
  }, [failed, passed, executionID, pending, collapseOnPass]);
  return (
    <details
      className="case-group disclosure"
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

function CaseIndicator({
  pending,
  status,
}: {
  pending: boolean;
  status?: PublicCaseResult["status"];
}) {
  if (pending) return <span className="case-spinner" aria-hidden="true" />;
  if (!status || status === "executed") return null;
  return (
    <Icon
      name={status === "accepted" ? "submit" : "close"}
      className={status === "accepted" ? "verdict-success" : "verdict-error"}
    />
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
