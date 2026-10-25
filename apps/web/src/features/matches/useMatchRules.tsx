import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";
import { reportRuleEvent } from "./api";
import { createRuleMonitor, observeWindowFocus } from "./ruleMonitor";
import { Tooltip } from "../editor/components/Tooltip";

export function useMatchRules(identity: DevelopmentIdentity, match?: MatchSnapshot) {
  const queryClient = useQueryClient();
  const own = match?.participants.find((player) => player.userId === participantUserId(identity));
  const active = match?.state === "active" && !!own && !own.forfeited;
  const [notice, setNotice] = useState<{ scope: string; text: string }>();
  const scope = `${identity}:${match?.id}`;
  const clipboard = match?.rules.clipboard ?? "off";
  const focus = match?.rules.focus ?? "off";
  useEffect(() => {
    if (!active || !match) return;
    const monitor = createRuleMonitor({ clipboard, focus }, (kind, action) => {
      const reason =
        kind === "clipboard" ? "Copy/paste is disabled." : "Keep this match window focused.";
      setNotice({ scope, text: reason });
      if (action === "warning") return;
      void reportRuleEvent(identity, match.id, kind)
        .then(() => queryClient.invalidateQueries({ queryKey: ["match", identity, match.id] }))
        .catch(() =>
          setNotice({
            scope,
            text: `${reason} Rule report failed; reconnect to confirm match state.`,
          }),
        );
    });
    const clipboardAttempt = (event: Event) => {
      const anchor = window.getSelection()?.anchorNode;
      const selectionTarget = anchor instanceof Element ? anchor : anchor?.parentElement;
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        !target?.closest(".coding-pane, .problem-pane") &&
        !selectionTarget?.closest(".coding-pane, .problem-pane")
      )
        return;
      if (monitor.clipboard()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    for (const type of ["copy", "cut", "paste"])
      document.addEventListener(type, clipboardAttempt, true);
    const stopFocus = observeWindowFocus(monitor.focus);
    return () => {
      for (const type of ["copy", "cut", "paste"])
        document.removeEventListener(type, clipboardAttempt, true);
      stopFocus();
    };
  }, [active, match?.id, clipboard, focus, identity, scope, queryClient]);
  return {
    blocked: !!own?.forfeited,
    notice: active && notice?.scope === scope ? notice.text : undefined,
    dismiss: () => setNotice(undefined),
  };
}

export function MatchRuleNotice({
  message,
  onDismiss,
}: {
  message?: string;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="match-rule-notice" role="status">
      <ShieldAlert size={18} />
      <span>{message}</span>
      <Tooltip content="Dismiss">
        <button className="icon-button" aria-label="Dismiss rule warning" onClick={onDismiss}>
          <X size={16} />
        </button>
      </Tooltip>
    </div>
  );
}
