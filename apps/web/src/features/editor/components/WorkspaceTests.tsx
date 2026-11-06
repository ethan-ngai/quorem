import { AuthoringTabs } from "../../../ui/AuthoringTabs";
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
  if (onDraftsChange) tabs.push("custom");
  const selected = tabs.includes("custom") && customMode;
  const selectedTab = selected ? "custom" : "samples";
  const detachedCustomRun = selected && !!submission?.customRun && !snapshot;
  function selectTab(tab: "samples" | "custom") {
    onCustomModeChange?.(tab === "custom");
  }

  return (
    <>
      {!hideToolbar && (
        <div className="results-toolbar">
          <AuthoringTabs
            label="Tests"
            appearance="default"
            value={selectedTab}
            onChange={selectTab}
            tabId={(tab) => `tests-${tab}-tab`}
            panelId={(tab) => `tests-${tab}-panel`}
            tabs={tabs.map((tab) => ({
              value: tab,
              icon: <Icon name={tab === "custom" ? "custom" : "samples"} />,
              label: tab === "custom" ? "Custom cases" : "Examples",
            }))}
          />
        </div>
      )}
      <div className="results-content case-results-content">
        <div aria-live="polite" className="case-result-summary">
          {detachedCustomRun && (
            <p className="result-message">Latest custom run; inputs may differ from your drafts.</p>
          )}
          <ResultContent
            submission={submission}
            busy={busy}
            error={error}
            showCases={detachedCustomRun}
            sql={problem.sql}
            returnType={problem.odyssey ? undefined : problem.signature.returnType}
            showVerdict={!odyssey || selected}
            detailsVisible={detailsVisible}
            customMode={selected}
            runWasCustom={snapshot?.custom ?? submission?.customRun}
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
