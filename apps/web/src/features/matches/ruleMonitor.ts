type RuleAction = "off" | "warning" | "cooldown" | "announce";
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
    focus(present: boolean) {
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
