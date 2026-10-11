/** @file Icon.tsx @description Consistent functional workspace symbols. @module editor */
import type { SVGProps } from "react";

const paths = {
  share: "M12 16V3m-4 4 4-4 4 4M5 12v9h14v-9",
  ready: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 12l3 3 5-6",
  flag: "M5 21V3m0 1c5-4 9 4 14 0v9c-5 4-9-4-14 0",
  enter: "M20 5v9H4m5-5-5 5 5 5",
  keyboard: "M3 6h18v12H3ZM6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 15h10",
  save: "M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8",
  explanation: "M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0L15 18H9Z",
  terminal: "m4 6 5 6-5 6M12 18h8",
  lock: "M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  problem: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 12h8M8 16h6",
  results: "M4 3v18h17M8 16l4-5 4 2 5-7",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  samples: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 15l2 2 5-5",
  custom:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6m-10 7 5-5 2 2-5 5-3 1Z",
  input: "M14 3h6v18h-6M3 12h12m-4-4 4 4-4 4",
  output: "M10 3H4v18h6m-1-9h12m-4-4 4 4-4 4",
  target:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-4 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-3 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  plus: "M12 5v14M5 12h14",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  chevron: "m8 10 4 4 4-4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "eye-off":
    "m3 3 18 18M10.5 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 3.8M6.2 6.2A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2",
  play: "m8 5 11 7-11 7Z",
  submit: "m5 12 4 4L19 6",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2",
  close: "m6 6 12 12M6 18 18 6",
  copy: "M9 9h11v11H9ZM4 15H3V3h12v1",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M18 8a4 4 0 0 1 0 8m2 5v-2a4 4 0 0 0-3-3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
};

/** @returns A stroke icon with inherited color and accessible label on its parent. */
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** @returns The compact Quorem mark, formed from opposed code brackets. */
export function Brand() {
  return (
    <a className="wordmark" href="/run-widths" aria-label="Quorem home">
      <svg viewBox="0 0 30 30" width="26" height="26" fill="none" aria-hidden="true">
        <path
          d="m11 5-8 10 8 10M19 5l8 10-8 10M17 8l-4 14"
          stroke="currentColor"
          strokeWidth="2.4"
        />
      </svg>
      <span>
        quorem<span className="brand-period">.</span>
      </span>
    </a>
  );
}

export function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      className="visibility-icon"
      data-visible={visible}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={paths.eye} />
      <path className="eye-slash" pathLength="1" d="m3 3 18 18" />
    </svg>
  );
}
