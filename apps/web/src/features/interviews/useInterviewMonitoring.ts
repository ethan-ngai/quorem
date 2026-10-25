import { useEffect, useRef } from "react";
import type { InterviewSnapshot } from "@quorem/contracts";
import { createRuleMonitor, observeWindowFocus } from "../rooms/ruleMonitor";
import { createClipboardProvenance } from "./clipboardProvenance";
import type { InterviewRuleKind } from "./ruleEvents";

function copiedText(event: ClipboardEvent) {
  const written = event.clipboardData?.getData("text/plain");
  if (written) return written;
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === "password") return "";
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    return target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
  return window.getSelection()?.toString() ?? "";
}

export function useInterviewMonitoring(
  snapshot: InterviewSnapshot,
  report: (kind: InterviewRuleKind) => void,
) {
  const provenance = useRef(createClipboardProvenance()).current;
  const active = snapshot.state === "active" && snapshot.role === "interviewee";
  const paste = snapshot.monitoring?.paste !== false;
  const focus = snapshot.monitoring?.focus !== false;
  useEffect(() => {
    // Bubble after CodeMirror has populated its real copy payload, including whole-line copy.
    const remember = (event: ClipboardEvent) => {
      void provenance.remember(copiedText(event));
    };
    document.addEventListener("copy", remember);
    document.addEventListener("cut", remember);
    return () => {
      document.removeEventListener("copy", remember);
      document.removeEventListener("cut", remember);
    };
  }, [provenance]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const monitor = createRuleMonitor(
      { clipboard: paste ? "announce" : "off", focus: focus ? "announce" : "off" },
      (kind) => report(kind === "clipboard" ? "paste" : "focus"),
    );
    const pasted = async (event: ClipboardEvent) => {
      if (
        !paste ||
        !(event.target instanceof Element) ||
        !event.target.closest(".coding-pane .cm-editor")
      )
        return;
      const internal = await provenance.isInternal(
        event.clipboardData?.getData("text/plain") ?? "",
      );
      if (!disposed && !internal) monitor.clipboard();
    };
    // Observe only: pasting and editing retain their normal browser behavior.
    document.addEventListener("paste", pasted, true);
    const stopFocus = observeWindowFocus(monitor.focus);
    return () => {
      disposed = true;
      document.removeEventListener("paste", pasted, true);
      stopFocus();
    };
  }, [active, paste, focus, report, provenance]);
}
