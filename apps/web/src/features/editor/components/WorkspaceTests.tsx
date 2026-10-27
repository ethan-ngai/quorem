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
  const odyssey = !!testProblem.odyssey;
  const tabs: ("samples" | "custom")[] = ["samples"];
  if (onDraftsChange && !odyssey && !problem.sql) tabs.push("custom");
  const selected = tabs.includes("custom") && customMode;
  const selectedTab = selected ? "custom" : "samples";
  function selectTab(tab: "samples" | "custom") {
    onCustomModeChange?.(tab === "custom");
  }

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
                aria-selected={selectedTab === tab}
                aria-controls={`tests-${tab}-panel`}
                tabIndex={selectedTab === tab ? 0 : -1}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const target =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length;
                  const next = tabs[target]!;
                  selectTab(next);
                  document.getElementById(`tests-${next}-tab`)?.focus();
                }}
              >
                <Icon name={tab === "custom" ? "custom" : "samples"} />
                {tab === "custom" ? "Custom cases" : "Examples"}
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
            showVerdict={!odyssey}
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
            hidden={selectedTab !== tab}
          >
            <TestCases
              key={`${problem.id}:${tab}`}
              caseStatuses={tab === "samples" ? progress?.caseStatuses : undefined}
              currentCaseGroup={
                progress && tab === "samples" ? `Step ${progress.level}` : undefined
              }
              caseGroups={
                tab === "samples"
                  ? progress?.levels.flatMap((level, index) =>
                      level.examples.map(() => `Step ${index + 1}`),
                    )
                  : undefined
              }
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
