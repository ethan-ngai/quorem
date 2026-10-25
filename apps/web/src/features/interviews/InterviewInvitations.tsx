/** @file InterviewInvitations.tsx @description Role-scoped invitation links with capability-aware native sharing. @module interviews */
import * as Popover from "../../ui/Popover";
import { Icon } from "../../ui/Icon";
import { ShareActions } from "../../ui/ShareActions";
import { useShareLink } from "../../ui/useShareLink";
import { Tooltip } from "../../ui/Tooltip";
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
  const { copied, sharing, copy, share } = useShareLink();
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
              copied={copied === data.url}
              sharing={sharing}
              copyLabel={`Copy ${label.toLowerCase()} invitation`}
              shareLabel={`Share ${label.toLowerCase()} invitation`}
              onCopy={() => void copy(data)}
              onShare={() => void share(data)}
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
