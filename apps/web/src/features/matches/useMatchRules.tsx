import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reportRuleEvent } from "./api";
import { createRuleMonitor, observeWindowFocus } from "../rooms/ruleMonitor";

export function useMatchRules(identity: DevelopmentIdentity, match?: MatchSnapshot) {
  const queryClient = useQueryClient();
  const own = match?.participants.find((player) => player.userId === participantUserId(identity));
  const active = match?.state === "active" && !!own && !own.forfeited;
  const scope = `${identity}:${match?.id}`;
  const clipboard = match?.rules.clipboard ?? "off";
  const copy = match?.rules.copy ?? "off";
  const focusGraceSeconds = match?.rules.focusGraceSeconds ?? 3;
  const focus = match?.rules.focus ?? "off";
  useEffect(() => {
    if (!active || !match) return;
    let disposed = false;
    const monitor = createRuleMonitor(
      { clipboard, copy, focus, focusGraceSeconds },
      (kind, action) => {
        const reason =
          kind === "focus"
            ? "Match window focus change recorded."
            : action === "warning"
              ? "Clipboard action is disabled."
              : "Clipboard action recorded.";
        toast.warning(reason, { id: `match-rule:${scope}` });
        if (action === "warning") return;
        void reportRuleEvent(identity, match.id, kind)
          .then(() => queryClient.invalidateQueries({ queryKey: ["match", identity, match.id] }))
          .catch(() => {
            if (!disposed)
              toast.error(`${reason} Rule report failed; reconnect to confirm match state.`, {
                id: `match-rule:${scope}`,
              });
          });
      },
    );
    const clipboardAttempt = (event: Event) => {
      const anchor = window.getSelection()?.anchorNode;
      const selectionTarget = anchor instanceof Element ? anchor : anchor?.parentElement;
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        !target?.closest(".coding-pane, .problem-pane") &&
        !selectionTarget?.closest(".coding-pane, .problem-pane")
      )
        return;
      if (monitor.clipboard(event.type === "paste" ? "clipboard" : "copy")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    for (const type of ["copy", "cut", "paste"])
      document.addEventListener(type, clipboardAttempt, true);
    const stopFocus = observeWindowFocus(monitor.focus);
    return () => {
      disposed = true;
      for (const type of ["copy", "cut", "paste"])
        document.removeEventListener(type, clipboardAttempt, true);
      stopFocus();
      monitor.dispose();
      toast.dismiss(`match-rule:${scope}`);
    };
  }, [active, match?.id, clipboard, copy, focus, focusGraceSeconds, identity, scope, queryClient]);
  return { blocked: !!own?.forfeited };
}
