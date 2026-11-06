/** @file CompletionDemo.tsx @description Development-only completion fixtures. @module completion */
import { useEffect, useState } from "react";
import type { MatchReview } from "@quorem/contracts";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { SessionBar } from "../../ui/SessionBar";
import { ReviewToolbar, ReviewPaneHeader } from "../matches/ReviewToolbar";
import { EditorialCode } from "../editor/components/EditorialCode";
import { ExecutionActions } from "../editor/components/ExecutionActions";
import "../matches/review.css";
import { RotateCcw } from "lucide-react";
import { CompletionDialog } from "./CompletionDialog";
import { Celebration } from "../../ui/Celebration";
import { MatchSummaryMetadata } from "../matches/MatchSummaryMetadata";
import { MatchCompletionActions } from "../matches/MatchCompletionActions";
import { MatchWinnerMetadata } from "../matches/MatchWinnerMetadata";
import { LeaveLobbyButton } from "../matches/LeaveLobbyButton";
import { PartyReadinessIndicator, PartyMemberReadiness } from "../matches/PartyReadyStatus";
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
  const [inLobby, setInLobby] = useState(true);
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
                setInLobby(true);
                setReady(false);
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
        <SessionBar label="Demo session" actions={null} onResults={() => setOpen(true)}>
          <span className="completion-demo-label">Local demo · illustrative results</span>
        </SessionBar>
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
      actions={<ExecutionActions disabled onRun={() => {}} onSubmit={() => {}} />}
    >
      {inline ? (
        <Celebration key={replay} outcome={mode === "Interview" ? "observer" : "success"} inline />
      ) : (
        <CompletionDialog
          key={replay}
          open={open}
          onOpenChange={setOpen}
          competitive={competitive}
          headerActions={
            competitive && inLobby ? (
              <LeaveLobbyButton
                disabled={false}
                onClick={() => {
                  setInLobby(false);
                  setReady(false);
                }}
              />
            ) : undefined
          }
          outcome={lost ? "loss" : "success"}
          title={
            competitive
              ? lost
                ? "Opponent won"
                : "Victory"
              : mode === "Odyssey finale"
                ? "Odyssey complete"
                : "Problem solved"
          }
          description={competitive ? "Two Sum" : "Your solution passed every test case."}
          context={
            competitive ? (
              <MatchSummaryMetadata mode="showdown" durationMinutes={30} difficulty="easy" />
            ) : (
              <span>Two Sum · Easy</span>
            )
          }
          actions={
            competitive ? (
              <MatchCompletionActions
                review={{
                  disabled: false,
                  onClick: () => {
                    setOpen(false);
                    setReview(true);
                  },
                }}
                lobby={inLobby ? "return" : "create"}
                readiness={
                  inLobby
                    ? {
                        ready,
                        disabled: false,
                        retry: false,
                        onClick: () => setReady(!ready),
                      }
                    : undefined
                }
              />
            ) : (
              <button className="button button-secondary" onClick={() => setOpen(false)}>
                Back to editor
              </button>
            )
          }
        >
          {competitive && (
            <>
              <ol className="match-result-players" aria-label="Match results">
                <li data-you="true">
                  <span>
                    <strong>{lost ? "Alex" : "You"}</strong>
                    <MatchWinnerMetadata elapsed="8:42" />
                  </span>
                  <span className="match-result-score">
                    {inLobby && (
                      <PartyReadinessIndicator
                        member={{ ready: lost ? true : ready, online: true }}
                      />
                    )}
                    <span className="match-result-score-value">24 / 24</span>
                  </span>
                </li>
                <li>
                  <span>
                    <strong>{lost ? "You" : "Alex"}</strong>
                  </span>
                  <span className="match-result-score">
                    {inLobby && (
                      <PartyReadinessIndicator
                        member={{ ready: lost ? ready : true, online: true }}
                      />
                    )}
                    <span className="match-result-score-value">18 / 24</span>
                  </span>
                </li>
              </ol>
              {inLobby && (
                <section className="match-lobby-joined" aria-label="Joined lobby">
                  <h3>Joined lobby</h3>
                  <PartyMemberReadiness
                    members={[
                      { displayName: "Sam", ready: false, online: true },
                      { displayName: "Jordan", ready: true, online: true },
                      { displayName: "Casey", ready: false, online: true },
                    ]}
                  />
                </section>
              )}
            </>
          )}
        </CompletionDialog>
      )}
    </WorkspaceLayout>
  );
}
