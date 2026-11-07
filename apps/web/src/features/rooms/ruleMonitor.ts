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
) {
  let absent = false;
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
  return {
    clipboard,
    focus(this: void, present: boolean) {
      if (present) {
        absent = false;
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (absent) return;
      absent = true;
      if (rules.focus === "off") return;
      const delay = (rules.focusGraceSeconds ?? 0) * 1000;
      if (!delay) report("focus", rules.focus);
      else
        timer = setTimeout(() => {
          if (absent) report("focus", rules.focus);
        }, delay);
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
