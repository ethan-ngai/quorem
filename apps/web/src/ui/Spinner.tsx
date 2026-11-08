/** @file Spinner.tsx @description Shared compact loading indicators. @module ui */
import { LoaderCircle } from "lucide-react";
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
