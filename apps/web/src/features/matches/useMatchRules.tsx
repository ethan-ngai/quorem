/** @file useMatchRules.tsx @description Match browser rule monitoring and local warnings. @module matches */
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { randomUUID } from "../../randomUUID";
import { reportRuleEvent } from "./api";
import { observeMatchEditorInput } from "./matchEditorInput";
import { focusReturnDescription } from "./matchTime";
import { createRoomAlertToasts } from "../rooms/roomAlertToasts";
import { createRuleMonitor, observeWindowFocus } from "../rooms/ruleMonitor";

export function useMatchRules(identity: DevelopmentIdentity, match?: MatchSnapshot) {
  const queryClient = useQueryClient();
  const own = match?.participants.find((player) => player.userId === participantUserId(identity));
  const active = match?.state === "active" && !!own && !own.forfeited;
  const matchId = match?.id;
  const clipboard = match?.rules.clipboard ?? "off";
  const copy = match?.rules.copy ?? "off";
  const focus = match?.rules.focus ?? "off";
  useEffect(() => {
    if (!active || !matchId) return;
    let disposed = false;
    const toastId = `match-rule:${identity}:${matchId}`;
    const focusToasts = createRoomAlertToasts();
    let departure: { key: string; sent?: Promise<boolean> } | undefined;

    const send = async (
      body: Parameters<typeof reportRuleEvent>[2],
      reason: string,
      key?: string,
    ) => {
      try {
        await reportRuleEvent(identity, matchId, body, key);
        void queryClient.invalidateQueries({ queryKey: ["match", identity, matchId] });
        return true;
      } catch {
        if (!disposed)
          toast.error(`${reason} Rule report failed; reconnect to confirm match state.`, {
            id: toastId,
          });
        return false;
      }
    };

    const monitor = createRuleMonitor(
      { clipboard, copy, focus },
      (kind, action) => {
        if (kind === "focus") {
          const reason = "left the match window.";
          const key = randomUUID();
          focusToasts.show(key, reason, { prefix: "You" });
          departure = {
            key,
            sent: action === "warning" ? undefined : send({ kind }, `You ${reason}`, key),
          };
          return;
        }
        const reason =
          action === "warning"
            ? kind === "copy"
              ? "Copying from the window is disabled."
              : "Pasting into the editor is disabled."
            : kind === "copy"
              ? "You copied from the window."
              : "You pasted into the editor.";
        toast.warning(reason, { id: toastId });
        if (action !== "warning") void send({ kind }, reason);
      },
      Date.now,
      (awaySeconds) => {
        if (!departure) return;
        const { key, sent } = departure;
        departure = undefined;
        const reason = `${focusReturnDescription(awaySeconds)}.`;
        focusToasts.show(key, reason, { returned: true, prefix: "You" });
        void sent?.then((accepted) => {
          if (accepted)
            void send({ kind: "focus", departureId: key, awaySeconds }, `You ${reason}`);
        });
      },
    );
    const stopEditorInput = observeMatchEditorInput(monitor.clipboard, () =>
      toast.warning("Dragging code or files into the match editor is disabled.", { id: toastId }),
    );
    const stopFocus = observeWindowFocus(monitor.focus);
    return () => {
      disposed = true;
      stopEditorInput();
      stopFocus();
      toast.dismiss(toastId);
      focusToasts.dismissAll();
    };
  }, [active, matchId, clipboard, copy, focus, identity, queryClient]);
  return { blocked: !!own?.forfeited };
}
