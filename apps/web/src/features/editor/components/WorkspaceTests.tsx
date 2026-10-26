/** @file WorkspaceTests.tsx @description Shared test tabs, verdict and case browser. @module editor */
import type { ProblemVersion, Submission, OdysseyProgress } from "@quorem/contracts";
import type { CustomCaseDraft, RunSnapshot } from "../customCases";
import { Icon } from "../../../ui/Icon";
import { ResultContent } from "./ResultContent";
import { TestCases } from "./TestCases";

const emptyDrafts: CustomCaseDraft[] = [];
const keepDrafts = () => {};

export function WorkspaceTests({
  problem,
  submission,
  busy,
  error,
  customMode = false,
  onCustomModeChange,
  drafts = emptyDrafts,
  onDraftsChange,
  snapshot,
  progress,
  hideToolbar = false,
  detailsVisible = false,
}: {
  problem: ProblemVersion;
  submission?: Submission;
  busy: boolean;
  error?: string;
  customMode?: boolean;
  onCustomModeChange?: (value: boolean) => void;
  drafts?: CustomCaseDraft[];
  onDraftsChange?: (drafts: CustomCaseDraft[]) => void;
  snapshot?: RunSnapshot;
  progress?: OdysseyProgress;
  hideToolbar?: boolean;
  detailsVisible?: boolean;
}) {
  const testProblem = progress
    ? {
        ...problem,
        odyssey: { levels: progress.levels },
        examples: progress.levels.flatMap((level) => level.examples),
      }
    : problem;
  const tabs =
    onDraftsChange && !problem.odyssey ? (["samples", "custom"] as const) : (["samples"] as const);
  const selected = tabs.length > 1 && customMode;
  const hiddenOnly =
    !testProblem.odyssey && !!submission?.hiddenCases?.length && !submission.publicCases?.length;
  return (
    <>
      {!hideToolbar && (
        <div className="results-toolbar">
          <div className="result-tabs" role="tablist" aria-label="Tests">
            {tabs.map((tab, index) => (
              <button
                key={tab}
                id={`tests-${tab}-tab`}
                role="tab"
                aria-selected={selected === (tab === "custom")}
                aria-controls={`tests-${tab}-panel`}
                tabIndex={selected === (tab === "custom") ? 0 : -1}
                onClick={() => onCustomModeChange?.(tab === "custom")}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const target =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index + 1) % tabs.length;
                  const next = tabs[target]!;
                  onCustomModeChange?.(next === "custom");
                  document.getElementById(`tests-${next}-tab`)?.focus();
                }}
              >
                <Icon name={tab === "custom" ? "custom" : hiddenOnly ? "lock" : "samples"} />
                {problem.odyssey
                  ? "Examples"
                  : tab === "custom"
                    ? "Custom cases"
                    : hiddenOnly
                      ? "Hidden cases"
                      : "Examples"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="results-content case-results-content">
        <div aria-live="polite" className="case-result-summary">
          <ResultContent
            submission={submission}
            busy={busy}
            error={error}
            showCases={false}
            detailsVisible={detailsVisible}
            customMode={selected}
            runWasCustom={snapshot?.custom}
          />
        </div>
        {tabs.map((tab) => (
          <div
            key={tab}
            id={`tests-${tab}-panel`}
            role="tabpanel"
            aria-labelledby={`tests-${tab}-tab`}
            hidden={selected !== (tab === "custom")}
          >
            <TestCases
              key={`${problem.id}:${tab}`}
              caseStatuses={progress?.caseStatuses}
              currentCaseGroup={progress ? `Step ${progress.level}` : undefined}
              caseGroups={progress?.levels.flatMap((level, index) =>
                level.examples.map(() => `Step ${index + 1}`),
              )}
              problem={testProblem}
              customMode={tab === "custom"}
              drafts={drafts}
              onDraftsChange={onDraftsChange ?? keepDrafts}
              submission={submission}
              snapshot={snapshot}
              busy={busy}
            />
          </div>
        ))}
      </div>
    </>
  );
}
