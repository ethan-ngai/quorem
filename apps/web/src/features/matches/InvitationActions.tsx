/** @file InvitationActions.tsx @description Shared lobby invitation controls and feedback. @module matches */
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { CopyFeedbackIcon } from "./CopyFeedbackIcon";

export function InvitationActions({
  copied,
  sharing,
  onCopy,
  onShare,
}: {
  copied: boolean;
  sharing: boolean;
  onCopy: () => void;
  onShare: () => void;
}) {
  return (
    <div className="invitation-actions">
      <Tooltip content={copied ? "Copied" : "Copy invitation"}>
        <button
          className={`icon-button copy-invitation ${copied ? "is-copied" : ""}`}
          aria-label={copied ? "Copied" : "Copy invitation"}
          onClick={onCopy}
        >
          <CopyFeedbackIcon copied={copied} />
        </button>
      </Tooltip>
      <Tooltip content="Share invitation, or copy if sharing is unavailable">
        <button
          className="icon-button"
          aria-label="Share invitation"
          disabled={sharing}
          onClick={onShare}
        >
          <Icon name="share" />
        </button>
      </Tooltip>
    </div>
  );
}
