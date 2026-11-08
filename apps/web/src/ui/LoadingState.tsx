/** @file LoadingState.tsx @description Shared loading feedback timing and accessible status. @module ui */
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useLayoutEffect, useState, type ReactNode } from "react";

export function useLoadingVisibility(active: boolean) {
  const [visible, setVisible] = useState(false);
  const delay = useDebouncer(() => setVisible(true), { wait: 200 });
  useLayoutEffect(() => {
    if (!active) {
      // Reset before paint so a new pending action always gets its own grace period.
      setVisible(false);
      return;
    }
    delay.maybeExecute();
    return () => delay.cancel();
  }, [active, delay]);
  return active && visible;
}

function GracedLoadingState({
  indicator,
  fallback,
}: {
  indicator: ReactNode;
  fallback?: ReactNode;
}) {
  return useLoadingVisibility(true) ? indicator : fallback;
}

export function LoadingState({
  active = true,
  immediate,
  label,
  fallback,
  children,
}: {
  active?: boolean;
  immediate?: boolean;
  label: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  if (!active) return fallback;
  const indicator = (
    <span role="status">
      {children}
      <span className="sr-only">{label}</span>
    </span>
  );
  return immediate ? indicator : <GracedLoadingState indicator={indicator} fallback={fallback} />;
}
