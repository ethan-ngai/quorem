/** @file LoadingScreen.tsx @description Branded loading states for pages and panels. @module ui */
import "./loading.css";

export function LogoSpinner() {
  return (
    <span className="logo-spinner" aria-hidden="true">
      <span className="logo-spinner-mark" />
    </span>
  );
}

export function LoadingScreen({
  label = "Opening workspace…",
  inline = false,
}: {
  label?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "loading-state loading-state-inline" : "loading-state"} role="status">
      <LogoSpinner />
      <span className="sr-only">{label}</span>
    </div>
  );
}
