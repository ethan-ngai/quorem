/**
 * @file Hero Swiss dots.
 * @description A spring grid with cursor repulsion, click ripples and slow opacity waves.
 * @module marketing/heroDots
 */
const field = document.querySelector<HTMLElement>(".hero-dots");
const canvas = field?.querySelector("canvas");
const context = canvas?.getContext("2d");
const hero = field?.closest(".hero");

if (field && canvas && context && hero) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const spacing = 12;
  type Dot = {
    x: number;
    y: number;
    dx: number;
    dy: number;
    vx: number;
    vy: number;
    spring: number;
  };
  let dots: Dot[] = [];
  let ripples: { x: number; y: number; born: number }[] = [];
  let width = 0;
  let height = 0;
  let color = "";
  let frame = 0;
  let previous = 0;
  let time = 0;
  let visible = false;
  let pointer = { x: -9999, y: -9999, moved: -10 };
  let lastActivity = -10;

  const draw = () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    for (const dot of dots) {
      const wave =
        (Math.sin(dot.x * 0.018 + dot.y * 0.009 + time * 0.55) +
          Math.sin(dot.x * -0.012 + dot.y * 0.016 + time * 0.38) +
          Math.sin(dot.x * 0.006 - dot.y * 0.014 + time * 0.22)) /
        3;
      context.globalAlpha = motion.matches ? 0.6 : 0.35 + 0.65 * (0.5 + 0.5 * wave);
      context.beginPath();
      context.arc(dot.x + dot.dx, dot.y + dot.dy, 1.125, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  };

  const tick = (now: number) => {
    frame = 0;
    if (!visible || document.hidden || motion.matches) return;
    const active = time - lastActivity < 3;
    // Idle shimmer runs at 30fps; interaction physics takes fixed 60Hz steps.
    if (previous && now - previous < (active ? 1000 / 60 : 1000 / 30) - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    const elapsed = previous ? Math.min((now - previous) / 1000, 0.05) : 1 / 60;
    previous = now;
    time += elapsed;
    ripples = ripples.filter((ripple) => time - ripple.born < 2);
    if (active) {
      const steps = Math.max(1, Math.round(elapsed * 60));
      for (let step = 0; step < steps; step++) {
        const force = Math.exp(-7 * (time - pointer.moved));
        for (const dot of dots) {
          dot.vx -= dot.dx * dot.spring;
          dot.vy -= dot.dy * dot.spring;
          const x = dot.x + dot.dx;
          const y = dot.y + dot.dy;
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0.1 && distance < 150 && force > 0.001) {
            const push = (1 - distance / 150) ** 2 * 10 * force;
            dot.vx += (dx / distance) * push;
            dot.vy += (dy / distance) * push;
          }
          for (const ripple of ripples) {
            const age = time - ripple.born;
            const rx = x - ripple.x;
            const ry = y - ripple.y;
            const radius = Math.hypot(rx, ry);
            const push = Math.exp(-((radius - age * 420) ** 2) / 500) * Math.exp(-age * 2.2) * 10;
            if (radius > 0.1) {
              dot.vx += (rx / radius) * push;
              dot.vy += (ry / radius) * push;
            }
          }
          dot.vx *= 0.8;
          dot.vy *= 0.8;
          dot.dx += dot.vx;
          dot.dy += dot.vy;
        }
      }
    }
    draw();
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (!frame && visible && !document.hidden && !motion.matches) {
      previous = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  };
  const resize = () => {
    const bounds = field.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    color = getComputedStyle(field).color;
    dots = [];
    for (let y = (height % spacing) / 2 + 6; y < height + 12; y += spacing) {
      for (let x = (width % spacing) / 2 + 6; x < width + 12; x += spacing) {
        const seed = Math.sin(x * 1.7 + y * 73) * 43758.5453;
        dots.push({
          x,
          y,
          dx: 0,
          dy: 0,
          vx: 0,
          vy: 0,
          spring: 0.018 * (0.8 + (seed - Math.floor(seed)) * 0.4),
        });
      }
    }
    draw();
    field.dataset.ready = "";
    start();
  };
  const position = (event: PointerEvent) => {
    const bounds = field.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const interactive = (event: PointerEvent) =>
    event.target instanceof Element &&
    !!event.target.closest('a,button,input,textarea,select,[role="button"]');
  hero.addEventListener("pointermove", (event) => {
    if (
      !(event instanceof PointerEvent) ||
      event.pointerType !== "mouse" ||
      motion.matches ||
      interactive(event)
    )
      return;
    pointer = { ...position(event), moved: time };
    lastActivity = time;
    start();
  });
  hero.addEventListener("pointerleave", () => {
    pointer.moved = -10;
  });
  hero.addEventListener("pointerdown", (event) => {
    if (
      !(event instanceof PointerEvent) ||
      !event.isPrimary ||
      motion.matches ||
      interactive(event)
    )
      return;
    ripples.push({ ...position(event), born: time });
    if (ripples.length > 6) ripples.shift();
    lastActivity = time;
    start();
  });
  new ResizeObserver(resize).observe(field);
  new MutationObserver(() => {
    color = getComputedStyle(field).color;
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) start();
    else stop();
  }).observe(hero);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  motion.addEventListener("change", () => {
    stop();
    ripples = [];
    pointer.moved = -10;
    resize();
  });
  resize();
}
export {};
