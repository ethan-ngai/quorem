/** @file InviteFriends.tsx @description Invite accepted friends from the lobby. @module matches */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LoadingButton } from "../../ui/LoadingButton";
import { friendsKey, getFriends, inviteFriend } from "../notifications/api";

export function InviteFriends({
  actor,
  party,
  locked,
}: {
  actor: string;
  party: string;
  locked?: boolean;
}) {
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const friends = useQuery({
    queryKey: friendsKey(actor),
    queryFn: ({ signal }) => getFriends(signal),
  });
  const send = useMutation({
    mutationFn: (player: string) => inviteFriend(party, player),
    onSuccess: (_, player) => setSent((before) => new Set([...before, player])),
  });
  return (
    <section className="invite-friends">
      <h3>Friends</h3>
      {friends.isPending && <p role="status">Loading friends…</p>}
      {friends.isError && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void friends.refetch()}
        >
          Retry loading friends
        </button>
      )}
      {friends.data?.length === 0 && <p>Find friends on the Social page.</p>}
      {!!friends.data?.length && (
        <ul className="friend-list">
          {friends.data.map((friend) => (
            <li key={friend.id}>
              <span>{friend.displayName}</span>
              <LoadingButton
                type="button"
                className="button button-secondary"
                pending={send.isPending && send.variables === friend.id}
                disabled={locked || send.isPending || sent.has(friend.id)}
                onClick={() => send.mutate(friend.id)}
              >
                {sent.has(friend.id) ? "Invited" : "Invite"}
              </LoadingButton>
            </li>
          ))}
        </ul>
      )}
      {send.isError && <p role="alert">{send.error.message}</p>}
    </section>
  );
}
