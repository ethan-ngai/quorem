/** @file InterviewParticipants.tsx @description Readable participant roster and role management. @module interviews */
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
          <h2>Participants</h2>
          <ul className="interview-roster">
            {[...snapshot.members]
              .sort(
                (a, b) =>
                  Number(b.userId === snapshot.hostId) - Number(a.userId === snapshot.hostId),
              )
              .map((member) => {
                const editable = canManage && member.userId !== snapshot.hostId;
                return (
                  <li key={member.userId}>
                    <span className="account-avatar" aria-hidden="true">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
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
                  </li>
                );
              })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
