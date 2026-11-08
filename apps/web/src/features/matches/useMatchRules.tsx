import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reportRuleEvent } from "./api";
import { observeMatchEditorInput } from "./matchEditorInput";
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
            ? "You left the match window."
            : action === "warning"
              ? kind === "copy"
                ? "Copying from the window is disabled."
                : "Pasting into the editor is disabled."
              : kind === "copy"
                ? "You copied from the window."
                : "You pasted into the editor.";
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
    const stopEditorInput = observeMatchEditorInput(monitor.clipboard, () =>
      toast.warning("Dragging code or files into the match editor is disabled.", {
        id: `match-rule:${scope}`,
      }),
    );
    const stopFocus = observeWindowFocus(monitor.focus);
    return () => {
      disposed = true;
      stopEditorInput();
      stopFocus();
      monitor.dispose();
      toast.dismiss(`match-rule:${scope}`);
    };
  }, [active, match?.id, clipboard, copy, focus, focusGraceSeconds, identity, scope, queryClient]);
  return { blocked: !!own?.forfeited };
}
