type RuleAction = "off" | "warning" | "announce";
export type RuleKind = "clipboard" | "focus";

/** One focus violation per absence, even when blur and visibility fire together. */
export function createRuleMonitor(
  rules: { clipboard: RuleAction; focus: RuleAction },
  report: (kind: RuleKind, action: RuleAction) => void,
  now = Date.now,
) {
  let absent = false;
  let lastClipboard = -Infinity;
  return {
    clipboard() {
      if (rules.clipboard === "off") return false;
      if (now() - lastClipboard >= 1000) {
        lastClipboard = now();
        report("clipboard", rules.clipboard);
      }
      return true;
    },
    focus(this: void, present: boolean) {
      if (present) {
        absent = false;
        return;
      }
      if (absent) return;
      absent = true;
      if (rules.focus !== "off") report("focus", rules.focus);
    },
  };
}

/** Shared browser signals; the rule monitor deduplicates blur and visibility changes. */
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
