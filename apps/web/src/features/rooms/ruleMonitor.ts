/** @file ruleMonitor.ts @description Deduplicated browser observations with focus grace. @module rooms */
type RuleAction = "off" | "warning" | "announce" | "penalty";
export type RuleKind = "clipboard" | "copy" | "focus";
export function createRuleMonitor(
  rules: {
    clipboard: RuleAction;
    copy?: RuleAction;
    focus: RuleAction;
    focusGraceSeconds?: number;
  },
  report: (kind: RuleKind, action: RuleAction) => void,
  now = Date.now,
  onFocusReturn?: (awaySeconds: number) => void,
) {
  const focusDelay = (rules.focusGraceSeconds ?? 0) * 1000;
  let leftAt: number | undefined;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const last = { clipboard: -Infinity, copy: -Infinity };
  const clipboard = (kind: "clipboard" | "copy" = "clipboard") => {
    const action = rules[kind] ?? "off";
    if (action === "off") return false;
    if (now() - last[kind] >= 1000) {
      last[kind] = now();
      report(kind, action);
    }
    return action === "warning";
  };
  const reportFocus = () => {
    reported = true;
    report("focus", rules.focus);
  };
  return {
    clipboard,
    focus(this: void, present: boolean) {
      if (rules.focus === "off") return;
      if (present) {
        if (leftAt === undefined) return;
        const elapsed = now() - leftAt;
        clearTimeout(timer);
        // Background timer throttling can delay a report until the tab regains focus.
        if (!reported && elapsed >= focusDelay) reportFocus();
        leftAt = undefined;
        if (reported) onFocusReturn?.(Math.max(0, Math.floor(elapsed / 1000)));
        reported = false;
        return;
      }
      if (leftAt !== undefined) return;
      leftAt = now();
      if (focusDelay) timer = setTimeout(reportFocus, focusDelay);
      else reportFocus();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
export function observeWindowFocus(focus: (present: boolean) => void) {
  const lost = () => focus(false);
  const restored = () => focus(document.visibilityState === "visible" && document.hasFocus());
  window.addEventListener("blur", lost);
  window.addEventListener("focus", restored);
  document.addEventListener("visibilitychange", restored);
  return () => {
    window.removeEventListener("blur", lost);
    window.removeEventListener("focus", restored);
    document.removeEventListener("visibilitychange", restored);
  };
}
