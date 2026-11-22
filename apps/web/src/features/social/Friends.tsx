/** @file Friends.tsx @description Private contacts and controls for a player relationship. @module social */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingButton } from "../../ui/LoadingButton";
import { changeFriend, friendsKey, getFriend, getFriends, inboxKey } from "../notifications/api";
import { Link } from "@tanstack/react-router";

export function Friends({ actor }: { actor: string }) {
  const friends = useQuery({
    queryKey: friendsKey(actor),
    queryFn: ({ signal }) => getFriends(signal),
  });
  return (
    <section aria-labelledby="friends-title">
      <h2 id="friends-title">Friends</h2>
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
      {friends.data?.length === 0 && (
        <p className="social-muted">Find a player below to send a friend request.</p>
      )}
      {!!friends.data?.length && (
        <ul className="friend-list">
          {friends.data.map((friend) => (
            <li key={friend.id}>
              <Link to="/players/$id" params={{ id: friend.id }}>
                {friend.displayName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FriendActions({ actor, player }: { actor: string; player: string }) {
  const client = useQueryClient();
  const queryKey = [...friendsKey(actor), player];
  const contact = useQuery({
    queryKey,
    queryFn: ({ signal }) => getFriend(player, signal),
    refetchOnWindowFocus: true,
  });
  const change = useMutation({
    mutationFn: (action: Parameters<typeof changeFriend>[1]) => changeFriend(player, action),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: friendsKey(actor) }),
        client.invalidateQueries({ queryKey: inboxKey(actor) }),
      ]);
    },
  });
  const state = contact.data?.state;
  if (!state)
    return contact.isError ? (
      <button
        type="button"
        className="button button-secondary"
        onClick={() => void contact.refetch()}
      >
        Retry loading friendship
      </button>
    ) : null;
  const actions = {
    friend: [["remove", "Remove friend"]],
    incoming: [
      ["accept", "Accept request"],
      ["decline", "Decline"],
    ],
    outgoing: [["remove", "Cancel request"]],
    blocked: [["unblock", "Unblock"]],
    none: [["request", "Add friend"]],
  } as const;
  const available = actions[state];
  return (
    <div className="friend-actions">
      {[...available, ...(state === "blocked" ? [] : ([["block", "Block"]] as const))].map(
        ([action, label]) => (
          <LoadingButton
            key={action}
            type="button"
            className="button button-secondary"
            disabled={change.isPending}
            pending={change.isPending && change.variables === action}
            onClick={() => change.mutate(action)}
          >
            {label}
          </LoadingButton>
        ),
      )}
      {change.isError && <p role="alert">{change.error.message}</p>}
    </div>
  );
}
