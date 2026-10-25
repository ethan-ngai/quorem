/** @file ShareActions.tsx @description Shared copy/native-share controls with consistent capability checks and tooltips. @module ui */
import { Tooltip } from "../features/editor/components/Tooltip";
import { Icon } from "../features/editor/components/Icon";
import { CopyFeedbackIcon } from "./CopyFeedbackIcon";
import { canShareLink, type ShareLinkData } from "./shareLink";

export function ShareActions({
  data,
  copied,
  sharing,
  onCopy,
  onShare,
  copyLabel = "Copy invitation",
  shareLabel = "Share invitation",
}: {
  data: ShareLinkData;
  copied: boolean;
  sharing: boolean;
  onCopy: () => void;
  onShare: () => void;
  copyLabel?: string;
  shareLabel?: string;
}) {
  return (
    <div className="invitation-actions">
      <Tooltip content={copied ? "Copied" : copyLabel}>
        <button
          type="button"
          className={`icon-button copy-invitation ${copied ? "is-copied" : ""}`}
          aria-label={copyLabel}
          onClick={onCopy}
        >
          <CopyFeedbackIcon copied={copied} />
        </button>
      </Tooltip>
      {canShareLink(data) && (
        <Tooltip content={shareLabel}>
          <button
            type="button"
            className="icon-button"
            aria-label={shareLabel}
            disabled={sharing}
            onClick={onShare}
          >
            <Icon name="share" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
