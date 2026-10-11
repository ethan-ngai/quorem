import {
  developmentUserIds,
  type DevelopmentIdentity,
  type MatchSnapshot,
} from "@quorem/contracts";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";
import { reportRuleEvent } from "./api";
import { createRuleMonitor } from "./ruleMonitor";
import { Tooltip } from "../editor/components/Tooltip";

export function useMatchRules(identity: DevelopmentIdentity, match?: MatchSnapshot) {
  const queryClient = useQueryClient();
  const own = match?.participants.find((player) => player.userId === developmentUserIds[identity]);
  const active = match?.state === "active" && !!own && !own.forfeited;
  const [notice, setNotice] = useState<{ scope: string; text: string }>();
  const [cooldown, setCooldown] = useState<{ scope: string; until: number }>();
  const scope = `${identity}:${match?.id}`;
  const clipboard = match?.rules.clipboard ?? "off";
  const focus = match?.rules.focus ?? "off";
  useEffect(() => {
    if (!active || !own?.cooldownUntil || !match) return;
    const remaining = Date.parse(own.cooldownUntil) - Date.parse(match.serverNow);
    if (remaining > 0)
      setCooldown((current) => ({
        scope,
        until: Math.max(current?.scope === scope ? current.until : 0, Date.now() + remaining),
      }));
  }, [active, own?.cooldownUntil, match?.serverNow, scope]);
  useEffect(() => {
    if (!active || !match) return;
    const monitor = createRuleMonitor({ clipboard, focus }, (kind, action) => {
      const reason =
        kind === "clipboard" ? "Copy/paste is disabled." : "Keep this match window focused.";
      setNotice({ scope, text: reason });
      if (action === "warning") return;
      if (action === "cooldown")
        setCooldown((current) =>
          current?.scope === scope && current.until > Date.now()
            ? current
            : { scope, until: Date.now() + 30_000 },
        );
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
    const lostFocus = () => monitor.focus(false);
    const restoredFocus = () =>
      monitor.focus(document.visibilityState === "visible" && document.hasFocus());
    const visibility = () =>
      monitor.focus(document.visibilityState === "visible" && document.hasFocus());
    for (const type of ["copy", "cut", "paste"])
      document.addEventListener(type, clipboardAttempt, true);
    window.addEventListener("blur", lostFocus);
    window.addEventListener("focus", restoredFocus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      for (const type of ["copy", "cut", "paste"])
        document.removeEventListener(type, clipboardAttempt, true);
      window.removeEventListener("blur", lostFocus);
      window.removeEventListener("focus", restoredFocus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, match?.id, clipboard, focus, identity, scope, queryClient]);
  const until = active && cooldown?.scope === scope ? cooldown.until : 0;
  const [expired, setExpired] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setTimeout(() => setExpired(Date.now()), until - Date.now());
    return () => window.clearTimeout(timer);
  }, [until]);
  return {
    blocked: !!own?.forfeited || until > Math.max(Date.now(), expired),
    until,
    notice: active && notice?.scope === scope ? notice.text : undefined,
    dismiss: () => setNotice(undefined),
  };
}

export function MatchRuleNotice({
  message,
  until,
  onDismiss,
}: {
  message?: string;
  until: number;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  const seconds = Math.max(0, Math.ceil((until - Math.max(now, Date.now())) / 1000));
  if (!message && !seconds) return null;
  return (
    <div className="match-rule-notice" role="status">
      <ShieldAlert size={18} />
      <span>{seconds ? `Run and Submit paused · ${seconds}s` : message}</span>
      {!seconds && (
        <Tooltip content="Dismiss">
          <button className="icon-button" aria-label="Dismiss rule warning" onClick={onDismiss}>
            <X size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
