/** @file InterviewInvitations.tsx @description Role-scoped invitation links with capability-aware native sharing. @module interviews */
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { Copy, Check, Link, Share2 } from "lucide-react";
import { Tooltip } from "../editor/components/Tooltip";
import { useErrorNotification } from "../../ui/Notifications";
import type { InterviewRole } from "@quorem/contracts";
import "./session-controls.css";

export type InterviewInvites = Partial<Record<InterviewRole, string>>;

export function InterviewInvitationLinks({ invites }: { invites: InterviewInvites }) {
  const [copied, setCopied] = useState<InterviewRole>();
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(undefined), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function send(role: InterviewRole, path: string, native = false) {
    const url = new URL(path, window.location.origin).href;
    setError(undefined);
    try {
      if (native) await navigator.share({ title: "Quorem interview", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(role);
      }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        setError("Could not share invitation. Try copying the link.");
    }
  }
  return (
    <div className="interview-invite-links">
      {(["interviewee", "interviewer"] as const).map((role) => {
        const path = invites[role];
        if (!path) return null;
        const data = { title: "Quorem interview", url: new URL(path, window.location.origin).href };
        const canShare =
          typeof navigator.share === "function" &&
          (!navigator.canShare || navigator.canShare(data));
        const label = role === "interviewer" ? "Interviewer" : "Interviewee";
        return (
          <div className="interview-invite-row" key={role}>
            <div>
              <strong>{label}</strong>
              <span>
                {role === "interviewer"
                  ? "Manage the interview and see every test"
                  : "Collaborate and run code"}
              </span>
            </div>
            <Tooltip
              content={copied === role ? "Copied" : `Copy ${label.toLowerCase()} invitation`}
            >
              <button
                type="button"
                className="icon-button"
                aria-label={`Copy ${label.toLowerCase()} invitation`}
                onClick={() => void send(role, path)}
              >
                {copied === role ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </Tooltip>
            {canShare && (
              <Tooltip content={`Share ${label.toLowerCase()} invitation`}>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Share ${label.toLowerCase()} invitation`}
                  onClick={() => void send(role, path, true)}
                >
                  <Share2 size={16} />
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
      <p className="case-stale">Anyone with a link can join with that role.</p>
    </div>
  );
}

export function InterviewInvitations({
  invites,
  onOpenChange,
}: {
  invites: InterviewInvites;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Tooltip content="Invite people">
        <Popover.Trigger asChild>
          <button type="button" className="icon-button" aria-label="Invite people">
            <Link size={18} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="interview-invite-popover"
          aria-label="Invite people"
          sideOffset={8}
          collisionPadding={12}
          align="end"
        >
          <h2>Invite people</h2>
          <InterviewInvitationLinks invites={invites} />
          <Popover.Arrow className="interview-invite-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
