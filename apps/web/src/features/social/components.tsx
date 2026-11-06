/** @file components.tsx @description Shared player identity, records and recoverable read failures. @module social */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { PlayerIdentity, ShowdownRecord } from "@quorem/contracts";
import { ParticipantName } from "../collaboration/ParticipantName";
export function PlayerLink({ player }: { player: PlayerIdentity }) {
  return (
    <Link className="identity-link" to="/players/$id" params={{ id: player.id }}>
      <ParticipantName participant={{ ...player, userId: player.id }} />
    </Link>
  );
}
export function ReadFailure({
  retry,
  children = "Could not load players. Try again.",
}: {
  retry: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="social-empty" role="alert">
      <p>{children}</p>
      <button className="button button-secondary" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
export function Record({ value }: { value: ShowdownRecord }) {
  return (
    <dl className="social-record">
      {(
        [
          ["Played", value.played],
          ["Wins", value.wins],
          ["Draws", value.draws],
          ["Losses", value.losses],
        ] as const
      ).map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count}</dd>
        </div>
      ))}
    </dl>
  );
}
