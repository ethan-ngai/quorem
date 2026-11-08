/** @file Spinner.tsx @description Shared compact loading indicators. @module ui */
import { LoaderCircle } from "lucide-react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useEffect, useState, type ReactNode } from "react";
import "./spinner.css";

export function Spinner({ size = 16, active = true }: { size?: number; active?: boolean }) {
  return (
    <LoaderCircle className="ui-spinner" size={size} data-active={active} aria-hidden="true" />
  );
}

export function LoadingIndicator({ label }: { label: string }) {
  return (
    <span className="loading-indicator" role="status">
      <Spinner />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function PendingSpinner({ label, fallback }: { label: string; fallback?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const delay = useDebouncer(() => setVisible(true), { wait: 200 });
  useEffect(() => {
    delay.maybeExecute();
    return () => delay.cancel();
  }, [delay]);
  return visible ? (
    <span role="status" aria-label={label}>
      <Spinner />
    </span>
  ) : (
    fallback
  );
}

/** Reserve the icon slot and skip feedback for quick refreshes. */
export function DelayedSpinner({
  active,
  label,
  fallback,
}: {
  active: boolean;
  label: string;
  fallback?: ReactNode;
}) {
  return (
    <span className="delayed-spinner">
      {active ? <PendingSpinner label={label} fallback={fallback} /> : fallback}
    </span>
  );
}
