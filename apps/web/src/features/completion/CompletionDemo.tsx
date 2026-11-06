/** @file CompletionDemo.tsx @description Development-only completion fixtures and future rematch preview. @module completion */
import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw, Users } from "lucide-react";
import { MatchSummaryMetadata } from "../matches/MatchSummaryMetadata";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { CompletionDialog } from "./CompletionDialog";
import { Celebration } from "../../ui/Celebration";
import { useTheme } from "../editor/useTheme";

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
                  <button className="button button-secondary" onClick={() => setOpen(false)}>
                    Review results
                  </button>
                  <button className="button button-primary" onClick={() => setOpen(false)}>
                    New match
                    <ArrowRight size={16} />
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
                    <small>Winner</small>
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
              <div className="completion-next">
                <strong>Same lobby · Upcoming</strong>
              </div>
              <div className="completion-actions" aria-label="Upcoming lobby features">
                <button className="button button-secondary" disabled>
                  <Users size={16} /> Return to lobby
                </button>
                <button className="button button-secondary" disabled>
                  <RotateCcw size={16} /> Quick requeue
                </button>
              </div>
            </>
          )}
        </CompletionDialog>
      )}
    </main>
  );
}
