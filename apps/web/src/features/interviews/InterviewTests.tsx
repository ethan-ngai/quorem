/** @file InterviewTests.tsx @description Authorized interview test collections use the shared case browser. @module interviews */
import { useId, useState } from "react";
import type { InterviewSnapshot, Submission } from "@quorem/contracts";
import { WorkspaceTests } from "../editor/components/WorkspaceTests";
import { TestCases } from "../editor/components/TestCases";
import { Icon } from "../editor/components/Icon";
import { ResultContent } from "../editor/components/ResultContent";

export function InterviewTests({
  question,
  interviewer,
  submission,
  busy,
  managing,
  closed,
  onReveal,
}: {
  question: InterviewSnapshot["question"];
  interviewer: boolean;
  submission?: Submission;
  busy: boolean;
  managing: boolean;
  closed: boolean;
  onReveal: (id: string, revealed: boolean) => void;
}) {
  const id = useId();
  const [collection, setCollection] = useState("shared");
  const tests = interviewer ? question.privateCaseDetails : question.revealedCases;
  const privateSelected = collection === "private" && !!tests?.length;
  const results = tests?.map((test) =>
    submission?.privateCaseResults?.find((result) => result.caseId === test.id),
  );
  return (
    <>
      {!!tests?.length && (
        <div className="results-toolbar">
          <div className="result-tabs" role="tablist" aria-label="Test collections">
            {(["shared", "private"] as const).map((name, index) => (
              <button
                type="button"
                key={name}
                role="tab"
                id={`${id}-${name}`}
                aria-controls={`${id}-panel`}
                aria-selected={privateSelected === (name === "private")}
                tabIndex={privateSelected === (name === "private") ? 0 : -1}
                onClick={() => setCollection(name)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const target =
                    event.key === "Home"
                      ? "shared"
                      : event.key === "End"
                        ? "private"
                        : index === 0
                          ? "private"
                          : "shared";
                  setCollection(target);
                  document.getElementById(`${id}-${target}`)?.focus();
                }}
              >
                <Icon name="samples" />
                {name === "shared"
                  ? "Shared examples"
                  : `${interviewer ? "Private tests" : "Revealed tests"} (${tests.length})`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        id={`${id}-panel`}
        role={tests?.length ? "tabpanel" : undefined}
        aria-labelledby={
          tests?.length ? `${id}-${privateSelected ? "private" : "shared"}` : undefined
        }
        className="interview-test-panel"
      >
        {privateSelected && tests ? (
          <div className="results-content case-results-content">
            <div className="case-result-summary" aria-live="polite">
              <ResultContent submission={submission} busy={busy} showCases={false} detailsVisible />
            </div>
            <TestCases
              problem={{
                ...question.problem,
                odyssey: question.progress ? { levels: question.progress.levels } : undefined,
                examples: tests.map((test) => test.case),
              }}
              customMode={false}
              drafts={[]}
              onDraftsChange={() => {}}
              busy={busy}
              submission={submission}
              caseResults={results}
              caseActions={(index) => {
                const test = tests[index]!;
                const level = Number(test.id.match(/^level:(\d+)/)?.[1]);
                return (
                  <div className="custom-case-heading">
                    <span>
                      {level ? `Step ${level} · ` : ""}
                      {test.revealed ? "Visible to everyone" : "Only interviewers"}
                    </span>
                    {interviewer && (
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={managing || closed}
                        onClick={() => onReveal(test.id, !test.revealed)}
                      >
                        {test.revealed ? "Hide from interviewees" : "Reveal to interviewees"}
                      </button>
                    )}
                  </div>
                );
              }}
            />
          </div>
        ) : (
          <WorkspaceTests
            detailsVisible={interviewer}
            hideToolbar={!!tests?.length}
            progress={question.progress}
            problem={question.problem}
            submission={submission ? { ...submission, hiddenCases: undefined } : undefined}
            busy={busy}
          />
        )}
      </div>
    </>
  );
}
