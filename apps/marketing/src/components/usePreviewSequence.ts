import { useEffect, useRef, useState } from "react";
/** Finite demos pause offscreen/hidden; reduced motion shows the final state. */
export function usePreviewSequence(
  finalStage: number,
  autoPlay: boolean,
  delay: number | ((stage: number) => number),
) {
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(finalStage);
  const [visible, setVisible] = useState(false);
  const [automatic, setAutomatic] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      setReduced(media.matches);
      if (media.matches) setStage(finalStage);
    };
    const syncHidden = () => setHidden(document.hidden);
    syncMotion();
    syncHidden();
    if (autoPlay && !media.matches) setStage(0);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    });
    if (root.current) observer.observe(root.current);
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncHidden);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncHidden);
    };
  }, [autoPlay, finalStage]);
  useEffect(() => {
    if (!visible || hidden || reduced || stage >= finalStage) return;
    const timer = setTimeout(
      () => setStage((value) => value + 1),
      typeof delay === "number" ? delay : delay(stage),
    );
    return () => clearTimeout(timer);
  }, [stage, visible, hidden, reduced, delay, finalStage]);
  return {
    root,
    stage,
    automatic,
    active: visible && !hidden && !reduced,
    replay: () => {
      setAutomatic(false);
      setStage(reduced ? finalStage : 0);
    },
  };
}
