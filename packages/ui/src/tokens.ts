export const workspaceLayout = {
  breakpoint: 900,
  statementMaxWidth: "68ch",
  problemPane: 40,
  editorPane: 60,
  paneMinimum: 280,
  resultsHeight: 240,
  controlHeight: 36,
  narrowTouchTarget: 44,
} as const;

export const motion = {
  fast: "120ms",
  standard: "180ms",
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;
