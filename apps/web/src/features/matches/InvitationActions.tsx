/** @file InvitationActions.tsx @description Competitive invitations use the shared share controls. @module matches */
import { ShareActions } from "../../ui/ShareActions";
export function InvitationActions({
  url,
  copied,
  sharing,
  onCopy,
  onShare,
}: {
  url: string;
  copied: boolean;
  sharing: boolean;
  onCopy: () => void;
  onShare: () => void;
}) {
  return (
    <ShareActions
      data={{ title: "Quorem match", text: "Join my coding match on Quorem.", url }}
      copied={copied}
      sharing={sharing}
      onCopy={onCopy}
      onShare={onShare}
    />
  );
}
