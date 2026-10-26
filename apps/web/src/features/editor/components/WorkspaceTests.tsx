/** @file WorkspaceTests.tsx @description Shared test tabs, verdict and case browser. @module editor */
import type { ProblemVersion, Submission, OdysseyProgress } from "@quorem/contracts";
import type { CustomCaseDraft, RunSnapshot } from "../customCases";
import { useState } from "react";
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
  const hiddenAvailable =
    odyssey &&
    submission?.kind === "submit" &&
    submission.state === "completed" &&
    !!submission.hiddenCases?.length;
  const tabs: ("samples" | "custom" | "hidden")[] = hiddenAvailable
    ? ["samples", "hidden"]
    : onDraftsChange && !odyssey
      ? ["samples", "custom"]
      : ["samples"];
  const [collection, setCollection] = useState<"samples" | "hidden">("samples");
  const selected = tabs.includes("custom") && customMode;
  const selectedTab = selected
    ? "custom"
    : collection === "hidden" && hiddenAvailable
      ? "hidden"
      : "samples";
  function selectTab(tab: "samples" | "custom" | "hidden") {
    setCollection(tab === "hidden" ? "hidden" : "samples");
    onCustomModeChange?.(tab === "custom");
  }
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
                <Icon
                  name={
                    tab === "custom"
                      ? "custom"
                      : tab === "hidden" || hiddenOnly
                        ? "lock"
                        : "samples"
                  }
                />
                {tab === "hidden"
                  ? "Hidden tests"
                  : odyssey
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
            showVerdict={!odyssey || selectedTab === "hidden"}
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
            {(tab !== "hidden" || selectedTab === "hidden") && (
              <TestCases
                hiddenMode={tab === "hidden"}
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
            )}
          </div>
        ))}
      </div>
    </>
  );
}
