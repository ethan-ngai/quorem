import { useEffect, useState } from "react";

/** Display server-provided retry delays; enforcement belongs to the server. */
export function useCooldown() {
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return {
    remaining: Math.max(0, Math.ceil((deadline - now) / 1000)),
    start(seconds: number) {
      const current = Date.now();
      setNow(current);
      setDeadline(current + seconds * 1000);
    },
  };
}
