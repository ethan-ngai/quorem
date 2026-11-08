/** @file Spinner.tsx @description Shared compact loading indicators. @module ui */
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { LoadingState, useLoadingVisibility } from "./LoadingState";
import { StateIcon } from "./StateIcon";
import "./spinner.css";

export function Spinner({ size = 16, active = true }: { size?: number; active?: boolean }) {
  return (
    <LoaderCircle className="ui-spinner" size={size} data-active={active} aria-hidden="true" />
  );
}

export function LoadingIndicator({ label, immediate }: { label: string; immediate?: boolean }) {
  return (
    <span className="loading-indicator">
      <LoadingState label={label} immediate={immediate}>
        <Spinner />
      </LoadingState>
    </span>
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
      <LoadingState active={active} label={label} fallback={fallback}>
        <Spinner />
      </LoadingState>
    </span>
  );
}

/** Keep the button's resting content and spinner in the same slot. */
export function SpinnerSwap({ pending, children }: { pending: boolean; children: ReactNode }) {
  const visible = useLoadingVisibility(pending);
  return <StateIcon active={visible} off={children} on={<Spinner active={visible} />} />;
}
