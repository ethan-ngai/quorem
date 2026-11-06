/** @file CompletionDemo.tsx @description Development-only completion fixtures. @module completion */
import { useEffect, useState } from "react";
import type { MatchReview } from "@quorem/contracts";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { ReviewToolbar, ReviewPaneHeader } from "../matches/ReviewToolbar";
import { EditorialCode } from "../editor/components/EditorialCode";
import { ExecutionActions } from "../editor/components/ExecutionActions";
import "../matches/review.css";
import { RotateCcw } from "lucide-react";
import { CompletionDialog } from "./CompletionDialog";
import { Celebration } from "../../ui/Celebration";
import { MatchSummaryMetadata } from "../matches/MatchSummaryMetadata";
import { PartyReadyStatus } from "../matches/PartyReadyStatus";
import { WorkspaceLayout, type WorkspacePanel } from "../editor/components/WorkspaceLayout";
import { PythonEditor } from "../editor/PythonEditor";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import "../../styles/workspace.css";

const source =
  "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i";

const opponentSource =
  "def two_sum(nums, target):\n    for i, a in enumerate(nums):\n        for j in range(i + 1, len(nums)):\n            if a + nums[j] == target:\n                return [i, j]";
const demoReview = {
  shareCodeAfterMatch: true,
  participants: [
    {
      userId: "you",
      displayName: "You",
      own: true,
      submission: { language: "python", source, state: "completed", verdict: "accepted" },
      workspace: null,
    },
    {
      userId: "alex",
      displayName: "Alex",
      own: false,
      submission: {
        language: "python",
        source: opponentSource,
        state: "completed",
        verdict: "wrong_answer",
      },
      workspace: null,
    },
  ],
} as MatchReview;

export function CompletionDemo() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Completion demo - Quorem";
    return () => {
      document.title = previous;
    };
  }, []);
  const [review, setReview] = useState(false);
  const [participant, setParticipant] = useState("you");
  const [drafts, setDrafts] = useState<Record<string, string>>({
    you: source,
    alex: opponentSource,
  });
  const [compare, setCompare] = useState(false);
  const [diff, setDiff] = useState(false);
  const [original, setOriginal] = useState(false);
  const other = participant === "you" ? "alex" : "you";
  const [mode, setMode] = useState("Competition");
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [replay, setReplay] = useState(0);
  const [panel, setPanel] = useState<WorkspacePanel>("code");
  const { theme, setPreference } = useTheme();
  const { editorSchemes, fontSize, tabSize, wrap } = useLocalEditorPreferences();
  const competitive = mode.startsWith("Competition");
  const lost = mode === "Competition loss";
  const inline = mode === "Interview" || mode === "Odyssey level";
  return (
    <WorkspaceLayout
      language="python"
      panel={panel}
      onPanelChange={setPanel}
      navigation={
        <div className="completion-demo-controls">
          {[
            "Practice",
            "Competition",
            "Competition loss",
            "Interview",
            "Odyssey level",
            "Odyssey finale",
          ].map((value) => (
            <button
              key={value}
              className="button button-secondary"
              onClick={() => {
                setMode(value);
                setReview(false);
                setReplay((n) => n + 1);
                setOpen(true);
              }}
            >
              {value}
            </button>
          ))}
          <button
            className="button button-secondary"
            onClick={() => {
              setReplay((n) => n + 1);
              setOpen(true);
            }}
          >
            <RotateCcw size={16} /> Replay
          </button>
          <button
            className="button button-secondary"
            onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
          >
            Switch theme
          </button>
        </div>
      }
      header={
        <>
          <strong>Local demo · illustrative results</strong>
          <button className="button button-secondary" onClick={() => setOpen(true)}>
            Results
          </button>
        </>
      }
      problem={
        <div className="problem-scroll">
          <div className="problem-heading">
            <h1>Two Sum</h1>
            <span className="difficulty difficulty-easy">Easy</span>
          </div>
          <p>
            Given an array of integers and a target, return the indices of two numbers that add up
            to the target.
          </p>
        </div>
      }
      editor={
        <>
          {review && (
            <>
              <ReviewToolbar
                review={demoReview}
                participantId={participant}
                disabled={false}
                compare={compare}
                diff={diff}
                original={original}
                canDiff
                onSelect={setParticipant}
                onCompare={() => setCompare(!compare)}
                onDiff={() => setDiff(!diff)}
                onOriginal={() => setOriginal(!original)}
                originalContent={
                  <>
                    <ReviewPaneHeader name="Original submission" language="python" original />
                    <EditorialCode
                      source={participant === "you" ? source : opponentSource}
                      language="python"
                      label="Original submission"
                      theme={theme}
                      colorScheme={editorSchemes[theme]}
                    />
                  </>
                }
              >
                <LanguageLogo language="python" tooltip="Python" />
              </ReviewToolbar>
            </>
          )}
          <div className="review-editor-grid">
            <div className="editor-frame">
              {review && compare && !diff && (
                <ReviewPaneHeader
                  name={participant === "you" ? "You" : "Alex"}
                  language="python"
                  active
                />
              )}
              <PythonEditor
                documentKey={`completion-demo:${participant}`}
                documentUri="file:///workspace/solution.py"
                initialSource={drafts[participant]!}
                theme={theme}
                colorScheme={editorSchemes[theme]}
                fontSize={fontSize}
                tabSize={tabSize}
                wrap={wrap}
                readOnly={!review}
                mergeOriginal={review && compare && diff ? drafts[other] : undefined}
                onSourceChange={(value) =>
                  setDrafts((current) => ({ ...current, [participant]: value }))
                }
              />
            </div>
            {review && compare && !diff && (
              <div className="review-reference">
                <ReviewPaneHeader
                  name={other === "you" ? "You" : "Alex"}
                  language="python"
                  onSelect={() => setParticipant(other)}
                />
                <PythonEditor
                  documentKey={`completion-demo:reference:${other}`}
                  documentUri="file:///workspace/solution.py"
                  initialSource={drafts[other]!}
                  language="python"
                  theme={theme}
                  colorScheme={editorSchemes[theme]}
                  fontSize={fontSize}
                  tabSize={tabSize}
                  wrap={wrap}
                  readOnly
                  onSourceChange={() => {}}
                />
              </div>
            )}
          </div>
        </>
      }
      results={<div className="result-message">Illustrative fixture · execution unavailable</div>}
      actions={
        <>
          {!review && <span>Round complete</span>}
          <ExecutionActions disabled onRun={() => {}} onSubmit={() => {}} />
        </>
      }
    >
      {inline ? (
        <Celebration key={replay} outcome={mode === "Interview" ? "observer" : "success"} inline />
      ) : (
        <CompletionDialog
          key={replay}
          open={open}
          onOpenChange={setOpen}
          competitive={competitive}
          outcome={lost ? "loss" : "success"}
          title={
            competitive
              ? lost
                ? "Opponent won"
                : "You won"
              : mode === "Odyssey finale"
                ? "Odyssey complete"
                : "Problem solved"
          }
          description={
            competitive
              ? "The first correct submission decided this match."
              : "Your solution passed every test case."
          }
          context={
            competitive ? (
              <MatchSummaryMetadata mode="showdown" durationMinutes={30} difficulty="easy" />
            ) : (
              <span>Two Sum · Easy</span>
            )
          }
          actions={
            <>
              <button
                className="button button-secondary"
                onClick={() => {
                  setOpen(false);
                  if (competitive) setReview(true);
                }}
              >
                {competitive ? "Review code" : "Back to editor"}
              </button>
              {competitive && (
                <>
                  <a className="button button-secondary" href="/party">
                    Return to lobby
                  </a>
                  <button className="button button-primary" onClick={() => setReady(!ready)}>
                    {ready ? "Unready" : "Ready up"}
                  </button>
                </>
              )}
            </>
          }
        >
          {competitive && (
            <>
              <ol className="match-result-players" aria-label="Match results">
                <li data-you="true">
                  <span>
                    <strong>{lost ? "Alex" : "You"}</strong>
                    <small>Winner · 8:42</small>
                  </span>
                  <span>24 / 24</span>
                </li>
                <li>
                  <span>
                    <strong>{lost ? "You" : "Alex"}</strong>
                  </span>
                  <span>18 / 24</span>
                </li>
              </ol>
              <PartyReadyStatus
                countdownEndsAt={null}
                members={[
                  { displayName: "You", ready, online: true },
                  { displayName: "Alex", ready: true, online: true },
                ]}
              />
            </>
          )}
        </CompletionDialog>
      )}
    </WorkspaceLayout>
  );
}
