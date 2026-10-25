/** @file LoginShowcase.tsx @description Marketing problem examples and restrained grid motion. @module auth */
import { useEffect, useRef } from "react";
import { Icon } from "../../ui/Icon";

function GridMesh() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = false;
    let width = 0;
    let height = 0;
    let color = "";
    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      context.strokeStyle = color;
      context.lineWidth = 0.7;
      const phase = reduced.matches ? 0 : time / 6000;
      const point = (x: number, y: number) => {
        const distance = Math.hypot(x - width * 0.48, y - height * 0.55);
        const influence = Math.exp(-distance / 220);
        return [
          x + Math.sin(y / 90 + phase) * 24 * influence,
          y + Math.cos(x / 100 + phase) * 30 * influence,
        ];
      };
      for (let axis = 0; axis < 2; axis++) {
        for (let line = -32; line <= (axis ? height : width) + 32; line += 32) {
          context.beginPath();
          for (let along = -32; along <= (axis ? width : height) + 32; along += 16) {
            const [x, y] = point(axis ? along : line, axis ? line : along);
            if (along === -32) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        }
      }
      if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden) draw();
    };
    const resize = new ResizeObserver(() => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(devicePixelRatio, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      color = getComputedStyle(canvas).color;
      restart();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      restart();
    });
    const theme = new MutationObserver(() => {
      color = getComputedStyle(canvas).color;
      restart();
    });
    resize.observe(canvas);
    intersection.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", restart);
      reduced.removeEventListener("change", restart);
    };
  }, []);
  return <canvas ref={ref} className="auth-grid" aria-hidden="true" />;
}

/** React port of the marketing ProblemCards example; isolated styles keep the editor untouched. */
export function LoginShowcase() {
  return (
    <aside className="auth-showcase" aria-label="Example coding problems">
      <GridMesh />
      <div className="auth-problem-stack">
        <div className="auth-problem-card auth-problem-back">
          <div>
            <strong>Trapping Rain Water</strong>
            <span className="auth-hard">Hard</span>
          </div>
          <span className="auth-topic">Two Pointers</span>
        </div>
        <div className="auth-problem-card auth-problem-middle">
          <div>
            <strong>Meeting Rooms II</strong>
            <span className="auth-medium">Medium</span>
          </div>
          <span className="auth-topic">Intervals</span>
        </div>
        <div className="auth-problem-card auth-problem-front">
          <div>
            <strong>Two Sum</strong>
            <span className="auth-easy">Easy</span>
          </div>
          <div className="auth-topics">
            <span className="auth-topic">Arrays</span>
            <span className="auth-topic">Hash Table</span>
          </div>
          <p>Find the two indices whose values add up to the target.</p>
          <div className="auth-example">
            <div>
              <Icon name="input" aria-label="Input" />
              <code>nums = [2, 7, 11, 15], target = 9</code>
            </div>
            <div>
              <Icon name="output" aria-label="Output" />
              <code>[0, 1]</code>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
