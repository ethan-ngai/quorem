/** @file CompletionDemo.tsx @description Development-only completion fixtures and future rematch preview. @module completion */
import { useEffect, useState } from "react";
import { RotateCcw, Users } from "lucide-react";
import { PartyReadyStatus } from "../matches/PartyReadyStatus";
import { MatchSummaryMetadata } from "../matches/MatchSummaryMetadata";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { CompletionDialog } from "./CompletionDialog";
import { Celebration } from "../../ui/Celebration";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { ReviewDiff } from "../matches/ReviewDiff";
import { EditorialCode } from "../editor/components/EditorialCode";

const yourCode =
  "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i";
const opponentCode =
  "def two_sum(nums, target):\n    for i, a in enumerate(nums):\n        for j in range(i + 1, len(nums)):\n            if a + nums[j] == target:\n                return [i, j]";

export function CompletionDemo() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Completion demo - Quorem";
    return () => {
      document.title = previous;
    };
  }, []);
  const [mode, setMode] = useState("Practice");
  const [open, setOpen] = useState(true);
  const [replay, setReplay] = useState(0);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [nextRound, setNextRound] = useState(false);
  const toggleReady = () => {
    const next = !ready;
    setReady(next);
    setNextRound(false);
    setCountdown(next ? new Date(Date.now() + 5000).toISOString() : null);
  };
  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(
      () => {
        setCountdown(null);
        setReady(false);
        setNextRound(true);
      },
      Math.max(0, Date.parse(countdown) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [countdown]);
  const [review, setReview] = useState(false);
  const [lobby, setLobby] = useState(false);
  const [diff, setDiff] = useState(false);
  const [compare, setCompare] = useState(false);
  const { editorSchemes } = useLocalEditorPreferences();
  const { theme, setPreference } = useTheme();
  const competitive = mode.startsWith("Competition");
  const lost = mode === "Competition loss";
  const observer = mode === "Interview";
  const step = mode === "Odyssey level";
  const finale = mode === "Odyssey finale";
  return (
    <main className="completion-demo">
      <p>LOCAL DEMO · Illustrative results</p>
      <h1>A good place to finish. A clear next step.</h1>
      <p>
        Choose a completion flow. Escape closes the summary; replay restarts the side bursts. System
        reduced-motion settings disable confetti.
      </p>
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
              setLobby(false);
              setReplay((value) => value + 1);
              setOpen(true);
            }}
          >
            {value}
          </button>
        ))}
        <button
          className="button button-secondary"
          onClick={() => {
            setReplay((value) => value + 1);
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
      {lobby && (
        <section aria-label="Lobby">
          <h2>Lobby</h2>
          <p>You · {ready ? "Ready" : "Not ready"} · Alex · Ready</p>
          {nextRound ? (
            <p role="status">Next round started · demo</p>
          ) : (
            <PartyReadyStatus
              members={[
                { displayName: "You", ready, online: true },
                { displayName: "Alex", ready: true, online: true },
              ]}
              countdownEndsAt={countdown}
            />
          )}
          <button className="button button-secondary" onClick={toggleReady}>
            {ready ? "Unready" : "Ready up"}
          </button>
          <button
            className="quiet-button"
            onClick={() => {
              setLobby(false);
              setOpen(true);
            }}
          >
            Results
          </button>
        </section>
      )}
      {review && (
        <section aria-label="Review code">
          <h2>Review code</h2>
          <p>Illustrative completed-round source</p>
          <button
            className="button button-secondary"
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            Compare
          </button>
          {compare && (
            <button
              className="button button-secondary"
              aria-pressed={diff}
              onClick={() => setDiff(!diff)}
            >
              Diff
            </button>
          )}
          {compare && diff ? (
            <ReviewDiff
              original={yourCode}
              source={opponentCode}
              language="python"
              theme={theme}
              colorScheme={editorSchemes[theme]}
            />
          ) : (
            <div className="review-demo-code">
              <div>
                <h3>Your code</h3>
                <EditorialCode
                  language="python"
                  theme={theme}
                  colorScheme={editorSchemes[theme]}
                  source={yourCode}
                  label="Your saved code"
                />
              </div>
              {compare && (
                <div>
                  <h3>Alex</h3>
                  <EditorialCode
                    language="python"
                    theme={theme}
                    colorScheme={editorSchemes[theme]}
                    source={opponentCode}
                    label="Alex submitted code"
                  />
                </div>
              )}
            </div>
          )}
          <button
            className="button button-secondary"
            onClick={() => {
              setReview(false);
              setOpen(true);
            }}
          >
            Back to results
          </button>
        </section>
      )}
      {step || observer ? (
        <>
          <p role="status">
            {observer
              ? "The candidate solved the problem. Both interview roles celebrate."
              : "Level 2 cleared. Continue to level 3 — no popup interrupts your code."}
          </p>
          <Celebration key={replay} outcome={observer ? "observer" : "success"} inline />
        </>
      ) : (
        <CompletionDialog
          key={replay}
          open={open}
          onOpenChange={setOpen}
          outcome={lost ? "loss" : "success"}
          title={
            competitive
              ? lost
                ? "Opponent won"
                : "You won"
              : finale
                ? "Odyssey complete"
                : "Problem solved"
          }
          description={
            competitive
              ? "The first correct submission decided this match."
              : finale
                ? "Every level cleared. Nicely done."
                : "Your solution passed every test case."
          }
          descriptionHidden={!competitive}
          context={
            competitive ? (
              <MatchSummaryMetadata mode="showdown" durationMinutes={30} difficulty="medium" />
            ) : (
              <div className="completion-problem">
                <span>{finale ? "Balance Ledger" : "Two Sum"}</span>
                <DifficultyLabel difficulty={finale ? "hard" : "easy"} />
              </div>
            )
          }
          competitive={competitive}
          stats={
            competitive
              ? undefined
              : [
                  {
                    label: finale ? "Levels cleared" : "Cases passed",
                    value: finale ? "4 / 4" : "24 / 24",
                    numeric: true,
                  },
                  {
                    label: "Language",
                    value: <LanguageLogo language="python" tooltip="Python" />,
                    hideLabel: true,
                  },
                ]
          }
          actions={
            <>
              {competitive ? (
                <>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setReview(true);
                      setOpen(false);
                    }}
                  >
                    Review code
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setLobby(true);
                      setOpen(false);
                    }}
                  >
                    <Users size={16} /> Return to lobby
                  </button>
                  <button
                    className={`button ${ready ? "button-secondary" : "button-primary"}`}
                    onClick={toggleReady}
                  >
                    {ready ? "Unready" : "Ready up"}
                  </button>
                </>
              ) : (
                <>
                  <button className="quiet-button" onClick={() => setOpen(false)}>
                    More problems
                  </button>
                  <button className="button button-primary" onClick={() => setOpen(false)}>
                    Back to editor
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
              {nextRound ? (
                <p role="status">Next round started · demo</p>
              ) : (
                <PartyReadyStatus
                  members={[
                    { displayName: "You", ready, online: true },
                    { displayName: "Alex", ready: true, online: true },
                  ]}
                  countdownEndsAt={countdown}
                />
              )}
            </>
          )}
        </CompletionDialog>
      )}
    </main>
  );
}
