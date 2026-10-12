/**
 * @file matchDemo.ts
 * @description Pausable example match, driven by one visible-time clock.
 * @module marketing
 */
const scene = document.querySelector<HTMLElement>(".match-scene")!;
const playback = scene.querySelector<HTMLButtonElement>(".scene-playback")!;
const typed = Array.from(scene.querySelectorAll<HTMLElement>(".scene-typed"));
const lines = typed.map((line) => line.dataset.code!);
const characterCount = lines.reduce((total, line) => total + line.length, 0);
const youScore = scene.querySelector<HTMLElement>("[data-you-score]")!;
const opponentScore = scene.querySelector<HTMLElement>("[data-opponent-score]")!;
const youBar = scene.querySelector<HTMLElement>(".scene-player-you .scene-track > span")!;
const opponentBar = scene.querySelector<HTMLElement>(".scene-player-opponent .scene-track > span")!;
const sceneStatus = scene.querySelector<HTMLElement>("[data-scene-status]")!;
const detail = scene.querySelector<HTMLElement>("[data-scene-detail]")!;
const clock = scene.querySelector<HTMLElement>(".scene-clock")!;
const resultIcon = scene.querySelector<HTMLElement>(".scene-result-icon")!;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const duration = 8800;
const cursor = scene.querySelector<HTMLElement>(".scene-code-cursor")!;
const phaseTimes = [0, 2400, 4600, 6800, 8000];
const opponentScores = [0, 6, 13, 18, 20];
const yourScores = [0, 0, 7, 12, 12];
let elapsed = duration;
let previousTime = 0;
let frame = 0;
let visible = false;
let paused = false;
let started = false;
let lastCharacters = -1;
let lastPhase = -1;
let lastSecond = -1;

/** Render only changed characters and submission snapshots, preserving geometry. */
function render() {
  const characters = Math.min(characterCount, Math.floor(Math.max(0, elapsed - 500) / 54));
  if (characters !== lastCharacters) {
    let remaining = characters;
    let activeLine = 0;
    typed.forEach((line, index) => {
      if (remaining > 0) activeLine = index;
      line.textContent = lines[index].slice(0, Math.max(0, remaining));
      remaining -= lines[index].length;
    });
    typed[activeLine].after(cursor);
    lastCharacters = characters;
  }
  const phase =
    elapsed < 2400 ? 0 : elapsed < 4600 ? 1 : elapsed < 6800 ? 2 : elapsed < 8000 ? 3 : 4;
  if (phase !== lastPhase) {
    const opponent = opponentScores[phase];
    const you = yourScores[phase];
    youScore.textContent = `${you} / 20`;
    opponentScore.textContent = `${opponent} / 20`;
    sceneStatus.textContent = phase === 4 ? "Jamie wins." : "Match in progress";
    detail.textContent =
      phase === 4
        ? "First correct submission · Match complete"
        : phase === 0
          ? "Both players are writing their solutions"
          : "Jamie submitted a new solution";
    resultIcon.textContent = phase === 4 ? "✓" : "·";
    lastPhase = phase;
  }
  const progress = Math.min(1, (elapsed - phaseTimes[phase]) / 600);
  const eased = 1 - (1 - progress) ** 3;
  const prior = Math.max(0, phase - 1);
  youBar.style.transform = `scaleX(${(yourScores[prior] + (yourScores[phase] - yourScores[prior]) * eased) / 20})`;
  opponentBar.style.transform = `scaleX(${(opponentScores[prior] + (opponentScores[phase] - opponentScores[prior]) * eased) / 20})`;
  const second = Math.floor(elapsed / 1000);
  if (second !== lastSecond) {
    clock.textContent = `08:${String(42 - second).padStart(2, "0")}`;
    lastSecond = second;
  }
}

/** Keep the playback name aligned with the visible example state. */
function updateControl() {
  const playing = !paused && elapsed < duration;
  playback.dataset.playing = String(playing);
  const label =
    elapsed >= duration
      ? "Replay example match"
      : paused
        ? "Resume example match"
        : "Pause example match";
  playback.setAttribute("aria-label", label);
  playback.title = label;
}

/** Advance only while visible; offscreen time cannot finish the match. */
function tick(time: number) {
  if (previousTime) elapsed = Math.min(duration, elapsed + time - previousTime);
  previousTime = time;
  render();
  if (elapsed < duration) frame = requestAnimationFrame(tick);
  else {
    frame = 0;
    updateControl();
  }
}

/** Resume the single frame loop only when motion and visibility permit. */
function syncPlayback() {
  cancelAnimationFrame(frame);
  frame = 0;
  previousTime = 0;
  if (!reduced.matches && visible && !document.hidden && !paused && elapsed < duration)
    frame = requestAnimationFrame(tick);
  updateControl();
}

playback.addEventListener("click", () => {
  if (elapsed >= duration) {
    elapsed = 0;
    lastPhase = -1;
    lastCharacters = -1;
    paused = false;
    render();
  } else paused = !paused;
  syncPlayback();
});
const observer = new IntersectionObserver(
  ([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !started && !reduced.matches) {
      started = true;
      elapsed = 0;
      render();
    }
    syncPlayback();
  },
  { threshold: 0.4 },
);
observer.observe(scene);
document.addEventListener("visibilitychange", syncPlayback);
reduced.addEventListener("change", () => {
  if (reduced.matches) {
    elapsed = duration;
    render();
  }
  playback.hidden = reduced.matches;
  syncPlayback();
});
playback.hidden = reduced.matches;

export {};
