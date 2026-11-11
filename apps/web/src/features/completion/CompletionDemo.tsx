/** @file CompletionDemo.tsx @description Development-only completion fixtures. @module completion */
import { useState, useTransition } from "react";
import type { MatchReview } from "@quorem/contracts";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { ParticipantName } from "../collaboration/ParticipantName";
import { ScoreProgress } from "../../ui/ScoreProgress";
import { participantColor } from "../collaboration/participantColor";
import { SessionBar } from "../../ui/SessionBar";
import { ReviewToolbar, ReviewPaneHeader } from "../matches/ReviewToolbar";
import { EditorialCode } from "../editor/components/EditorialCode";
import { ExecutionActions } from "../editor/components/ExecutionActions";
import "../matches/review.css";
import { RotateCcw } from "lucide-react";
import { CompletionDialog } from "./CompletionDialog";
import { Celebration } from "../../ui/Celebration";
import { MatchDurationRing } from "../matches/MatchDurationRing";
import { MatchSummaryMetadata } from "../matches/MatchSummaryMetadata";
import { PlayerCodeReviewButton, MatchCompletionActions } from "../matches/MatchCompletionActions";
import { hasReviewCode } from "../matches/useMatchReview";
import { MatchWinnerMetadata } from "../matches/MatchWinnerMetadata";
import { LeaveLobbyButton } from "../matches/LeaveLobbyButton";
import { PartyReadinessIndicator, MatchLobbyReadiness } from "../matches/PartyReadyStatus";
import { WorkspaceLayout, type WorkspacePanel } from "../editor/components/WorkspaceLayout";
import { PythonEditor } from "../editor/PythonEditor";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { usePageTitle } from "../navigation/PageMetadata";
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
      color: 18,
      displayName: "jamie",
      own: true,
      submission: { language: "python", source, state: "completed", verdict: "accepted" },
      workspace: null,
    },
    {
      userId: "alex",
      color: 5,
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
  usePageTitle("Completion Demo - Quorem");
  const [participant, setParticipant] = useState("you");
  const openReview = (participantId: string) => {
    setParticipant(participantId);
    setOriginal(false);
    setOpen(false);
  };
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
  const [readyPending, startReady] = useTransition();
  const [inLobby, setInLobby] = useState(true);
  const [replay, setReplay] = useState(0);
  const [panel, setPanel] = useState<WorkspacePanel>("code");
  const { theme, setPreference } = useTheme();
  const { editorSchemes, fontSize, tabSize, wrap } = useLocalEditorPreferences();
  const competitive = mode.startsWith("Competition");
  const review = competitive;
  const lost = mode === "Competition loss";
  const lobbyMembers = [
    ...demoReview.participants.map((person) => ({
      ...person,
      ready: person.own ? ready : true,
      online: true,
    })),
    { userId: "sam", displayName: "Sam", ready: false, online: true },
    { userId: "jordan", displayName: "Jordan", ready: true, online: true },
    { userId: "casey", displayName: "Casey", ready: false, online: true },
  ];
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
                setParticipant("you");
                setOriginal(false);
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
                canCompare
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
                  participant={demoReview.participants.find(
                    (person) => person.userId === participant,
                  )}
                  self={participant === "you"}
                  name={participant === "you" ? "jamie" : "Alex"}
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
                  participant={demoReview.participants.find((person) => person.userId === other)}
                  self={other === "you"}
                  name={other === "you" ? "jamie" : "Alex"}
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
          pending={readyPending}
          competitive={competitive}
          headerActions={
            competitive ? (
              <>
                <MatchDurationRing durationMinutes={30} elapsedSeconds={522} />
                {inLobby && (
                  <LeaveLobbyButton
                    disabled={readyPending}
                    onClick={() => {
                      setInLobby(false);
                      setReady(false);
                    }}
                  />
                )}
              </>
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
              <MatchSummaryMetadata mode="showdown" difficulty="easy" />
            ) : (
              <span>Two Sum · Easy</span>
            )
          }
          actions={
            competitive ? (
              <MatchCompletionActions
                review={{
                  disabled: false,
                  hasCode: demoReview.participants.some(hasReviewCode),
                  onClick: () => setOpen(false),
                }}
                lobby={inLobby ? "return" : "create"}
                readiness={
                  inLobby
                    ? {
                        ready,
                        pending: readyPending,
                        disabled: false,
                        retry: false,
                        onClick: () =>
                          startReady(async () => {
                            await new Promise((resolve) => setTimeout(resolve, 750));
                            setReady(!ready);
                          }),
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
                {(lost ? [...demoReview.participants].reverse() : demoReview.participants).map(
                  (player, index) => (
                    <li key={player.userId} data-you={player.own}>
                      <span>
                        <strong>
                          <ParticipantName
                            participant={player}
                            self={player.own}
                            nameSuffix={index === 0 && <MatchWinnerMetadata />}
                          />
                        </strong>
                      </span>
                      <span className="match-result-score">
                        {inLobby && (
                          <PartyReadinessIndicator
                            member={{ ready: player.own ? ready : true, online: true }}
                          />
                        )}
                        <ScoreProgress
                          score={{ passed: index === 0 ? 24 : 18, total: 24 }}
                          color={participantColor(player.userId, player.color)}
                        />
                        {hasReviewCode(player) && (
                          <PlayerCodeReviewButton
                            name={player.displayName}
                            onClick={() => openReview(player.userId)}
                          />
                        )}
                      </span>
                    </li>
                  ),
                )}
              </ol>
              {inLobby && (
                <MatchLobbyReadiness
                  ownUserId="you"
                  members={lobbyMembers}
                  participantIds={["you", "alex"]}
                />
              )}
            </>
          )}
        </CompletionDialog>
      )}
    </WorkspaceLayout>
  );
}
