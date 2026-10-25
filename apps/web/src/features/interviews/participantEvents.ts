import type { InterviewPresence } from "./presence";

/** Compare people, not editor windows. The initial roster and reconnects are silent. */
export function createParticipantTracker(clientID: string) {
  let previous: Map<string, string> | undefined;
  return {
    reset() {
      previous = undefined;
    },
    update(peers: readonly InterviewPresence[]) {
      const self = peers.find((peer) => peer.clientID === clientID);
      if (!self) return [];
      const current = new Map(
        peers.filter((peer) => peer.userId !== self.userId).map((peer) => [peer.userId, peer.name]),
      );
      const changes: { userId: string; name: string; joined: boolean }[] = [];
      if (previous) {
        for (const [userId, name] of current)
          if (!previous.has(userId)) changes.push({ userId, name, joined: true });
        for (const [userId, name] of previous)
          if (!current.has(userId)) changes.push({ userId, name, joined: false });
      }
      previous = current;
      return changes;
    },
  };
}
