/** @file DailyStreak.tsx @description Shared streak count and replayable artwork. @module activity */
import { useState } from "react";
import { StreakArtwork } from "./StreakArtwork";
import "./daily-streak.css";

export function DailyStreak({ days }: { days: number }) {
  const [replay, setReplay] = useState(0);
  return (
    <section className="daily-streak" aria-label="Daily streak">
      <button
        type="button"
        className="daily-streak-art"
        aria-label="Replay streak animation"
        onClick={() => setReplay((count) => count + 1)}
      >
        <StreakArtwork key={`${days}:${replay}`} active={days > 0} />
      </button>
      <div className="daily-streak-stat">
        <span className="daily-streak-label">Daily streak</span>
        <p className="daily-streak-number" aria-live="polite">
          <strong>{days}</strong> <span>{days === 1 ? "day" : "days"}</span>
        </p>
      </div>
    </section>
  );
}
