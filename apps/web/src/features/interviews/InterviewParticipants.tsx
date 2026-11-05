/** @file InterviewParticipants.tsx @description Readable participant roster and role management. @module interviews */
import { AnimatedRows } from "../../ui/AnimatedRows";
import { useRef } from "react";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { participantColor } from "../collaboration/participantColor";
import type { InterviewSnapshot, InterviewRole } from "@quorem/contracts";
import * as Popover from "../../ui/Popover";
import { SelectField } from "../../ui/SelectField";
import { Tooltip } from "../../ui/Tooltip";
import { Icon } from "../../ui/Icon";
import "./session-controls.css";

export function InterviewParticipants({
  snapshot,
  open,
  onOpenChange,
  busy,
  onRole,
  onRemove,
}: {
  snapshot: InterviewSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onRole: (id: string, role: InterviewRole) => void;
  onRemove: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const canManage = snapshot.role === "interviewer" && snapshot.state !== "closed";
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <Tooltip content="Participants">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="icon-button"
            aria-label={`Participants (${snapshot.members.length})`}
          >
            <Icon name="people" />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="interview-invite-popover interview-people-popover"
          aria-label="Participants"
          sideOffset={8}
          collisionPadding={12}
          align="end"
        >
          <h2 ref={heading} tabIndex={-1}>
            Participants
          </h2>
          <AnimatedRows
            as="ul"
            className="interview-roster"
            focusFallback={heading}
            items={[...snapshot.members].sort(
              (a, b) => Number(b.userId === snapshot.hostId) - Number(a.userId === snapshot.hostId),
            )}
            getKey={(member) => member.userId}
            renderRow={(member) => {
              const editable = canManage && member.userId !== snapshot.hostId;
              return (
                <>
                  <AccountAvatar
                    name={member.name}
                    image={member.image}
                    color={participantColor(member.userId, member.color)}
                    outline
                  />
                  <div className="interview-person">
                    <strong>{member.name}</strong>
                    <span>
                      {member.userId === snapshot.hostId
                        ? "Host"
                        : member.guest
                          ? "Guest"
                          : "Member"}
                    </span>
                  </div>
                  {editable ? (
                    <SelectField
                      className="select-field--compact"
                      label={`Role for ${member.name}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(role) => onRole(member.userId, role as InterviewRole)}
                      options={[
                        { value: "interviewer", label: "Interviewer" },
                        { value: "interviewee", label: "Interviewee" },
                      ]}
                    />
                  ) : (
                    <span className="interview-person-role">
                      {member.role === "interviewer" ? "Interviewer" : "Interviewee"}
                    </span>
                  )}
                  {editable && (
                    <Tooltip content="Remove participant">
                      <button
                        type="button"
                        className="icon-button destructive-icon"
                        aria-label={`Remove ${member.name}`}
                        disabled={busy}
                        onClick={() => onRemove(member.userId)}
                      >
                        <Icon name="close" />
                      </button>
                    </Tooltip>
                  )}
                </>
              );
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
