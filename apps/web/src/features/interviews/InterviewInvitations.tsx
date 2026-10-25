/** @file InterviewInvitations.tsx @description Role-scoped invitation links with capability-aware native sharing. @module interviews */
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { Icon } from "../editor/components/Icon";
import { ShareActions } from "../../ui/ShareActions";
import { shareLink } from "../../ui/shareLink";
import { Tooltip } from "../editor/components/Tooltip";
import { useErrorNotification } from "../../ui/Notifications";
import type { InterviewRole } from "@quorem/contracts";
import "./session-controls.css";

export type InterviewInvites = Partial<Record<InterviewRole, string>>;

export function InterviewInvitationLinks({
  invites,
  title = "Interview",
}: {
  invites: InterviewInvites;
  title?: string;
}) {
  const [copied, setCopied] = useState<InterviewRole>();
  const [sharing, setSharing] = useState(false);
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
    setSharing(native);
    try {
      if (native)
        await shareLink({
          title: `${title} · Quorem`,
          text: `Join ${title} on Quorem as an ${role}.`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(role);
      }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        setError("Could not share invitation. Try copying the link.");
    } finally {
      setSharing(false);
    }
  }
  return (
    <div className="interview-invite-links">
      {(["interviewee", "interviewer"] as const).map((role) => {
        const path = invites[role];
        if (!path) return null;
        const data = {
          title: `${title} · Quorem`,
          text: `Join ${title} on Quorem as an ${role}.`,
          url: new URL(path, window.location.origin).href,
        };
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
            <ShareActions
              data={data}
              copied={copied === role}
              sharing={sharing}
              copyLabel={`Copy ${label.toLowerCase()} invitation`}
              shareLabel={`Share ${label.toLowerCase()} invitation`}
              onCopy={() => void send(role, path)}
              onShare={() => void send(role, path, true)}
            />
          </div>
        );
      })}
    </div>
  );
}

export function InterviewInvitations({
  invites,
  onOpenChange,
  title,
}: {
  invites: InterviewInvites;
  title?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Tooltip content="Invite people">
        <Popover.Trigger asChild>
          <button type="button" className="icon-button" aria-label="Invite people">
            <Icon name="share" />
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
          <InterviewInvitationLinks invites={invites} title={title} />
          <Popover.Arrow className="interview-invite-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
