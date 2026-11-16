/** @file ruleMonitor.ts @description Deduplicated browser observations and time away. @module rooms */
type RuleAction = "off" | "warning" | "announce" | "penalty";
export type RuleKind = "clipboard" | "copy" | "focus";
export function createRuleMonitor(
  rules: {
    clipboard: RuleAction;
    copy?: RuleAction;
    focus: RuleAction;
  },
  report: (kind: RuleKind, action: RuleAction) => void,
  now = Date.now,
  onFocusReturn?: (awaySeconds: number) => void,
) {
  let leftAt: number | undefined;
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
  return {
    clipboard,
    focus(this: void, present: boolean) {
      if (rules.focus === "off") return;
      if (present) {
        if (leftAt === undefined) return;
        const elapsed = now() - leftAt;
        leftAt = undefined;
        onFocusReturn?.(Math.max(0, elapsed / 1000));
        return;
      }
      if (leftAt !== undefined) return;
      leftAt = now();
      report("focus", rules.focus);
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
