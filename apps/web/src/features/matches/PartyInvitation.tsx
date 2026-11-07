/** @file PartyInvitation.tsx @description Copy and share the current lobby invitation. @module matches */
import { UserPlus } from "lucide-react";
import type { PartySettings } from "@quorem/contracts";
import * as Popover from "../../ui/Popover";
import { ShareActions } from "../../ui/ShareActions";
import { TextInput } from "../../ui/TextControl";
import { useShareLink } from "../../ui/useShareLink";
import { matchModeLabels } from "./ModeIcon";

export function PartyInvitation({
  url,
  locked,
  hostName,
  settings,
}: {
  url: string;
  locked?: boolean;
  hostName?: string;
  settings: Pick<PartySettings, "mode" | "durationMinutes">;
}) {
  const { copied, sharing, copy, share } = useShareLink();
  const lobby = hostName ? `${hostName}’s lobby` : "the lobby";
  const mode = matchModeLabels[settings.mode ?? "showdown"];
  const data = {
    title: hostName ? `Join ${lobby} · Quorem` : "Quorem match invitation",
    text: `Join ${lobby} on Quorem for a ${settings.durationMinutes}-minute ${mode} match.`,
    url,
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="button button-secondary">
          <UserPlus size={16} aria-hidden="true" />
          Invite
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="lobby-invitation-popover"
          aria-label="Invite players"
          align="end"
        >
          <h2>Invite players</h2>
          {locked && <p>Joining is locked. Unlock the lobby to let players in.</p>}
          <div className="lobby-invitation-link">
            <TextInput
              aria-label="Invitation link"
              value={url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <ShareActions
              data={data}
              copied={copied === url}
              sharing={sharing}
              copyLabel="Copy invitation link"
              onCopy={() => void copy(data)}
              onShare={() => void share(data)}
            />
          </div>
          <span role="status" className="sr-only">
            {copied === url ? "Invitation link copied." : ""}
          </span>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
