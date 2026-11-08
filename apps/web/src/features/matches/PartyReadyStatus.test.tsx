import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  MatchLobbyReadiness,
  PartyReadyStatus,
  PartyMemberReadiness,
  PartyReadinessIndicator,
} from "./PartyReadyStatus";

it("shows each member's readiness and distinguishes an offline ready member", () => {
  const html = renderToStaticMarkup(
    <PartyMemberReadiness
      members={[
        { userId: "alice", displayName: "Alice", ready: true, online: true },
        { userId: "bob", displayName: "Bob", ready: true, online: false },
      ]}
    />,
  );
  expect(html).toContain("Alice");
  expect(html).toContain("Bob");
  expect(html).toContain('aria-label="Offline"');
  expect(html).toContain('aria-label="Ready"');
});

it("distinguishes not-ready players from players who left", () => {
  expect(
    renderToStaticMarkup(<PartyReadinessIndicator member={{ ready: false, online: true }} />),
  ).toContain('aria-label="Not ready"');
  expect(renderToStaticMarkup(<PartyReadinessIndicator />)).toContain('aria-label="Left lobby"');
});

it("marks the host without adding a separate self icon", () => {
  const html = renderToStaticMarkup(
    <PartyMemberReadiness
      members={[
        { userId: "alice", displayName: "Alice", ready: true, online: true },
        { userId: "bob", displayName: "Bob", ready: true, online: true },
      ]}
      hostUserId="alice"
      ownUserId="bob"
    />,
  );
  expect(html.match(/aria-label="Lobby host"/g)).toHaveLength(1);
  expect(html.match(/lucide-star/g)).toHaveLength(1);
  expect(html).not.toContain('aria-label="You"');
  expect(html).not.toContain("lucide-crown");
});

it("keeps countdown and failure feedback without idle readiness prose", () => {
  expect(renderToStaticMarkup(<PartyReadyStatus countdownEndsAt={null} />)).toBe("");
  const html = renderToStaticMarkup(
    <PartyReadyStatus countdownEndsAt={null} queueError="Choose another problem." />,
  );
  expect(html).toContain('aria-label="Next match unavailable"');
  expect(html).toContain("Choose another problem.");
  const countdown = renderToStaticMarkup(
    <PartyReadyStatus countdownEndsAt={new Date(Date.now() + 5000).toISOString()} />,
  );
  expect(countdown).toContain("Next match in 5s");
  const firstMatch = renderToStaticMarkup(
    <PartyReadyStatus countdownEndsAt={new Date(Date.now() + 5000).toISOString()} firstMatch />,
  );
  expect(firstMatch).toContain("Match in 5s");
  expect(firstMatch).not.toContain("Next match");
});

it("keeps the count without new members and lists only new arrivals", () => {
  const members = [
    { userId: "a", displayName: "Alice", ready: true, online: true },
    { userId: "b", displayName: "Bob", ready: true, online: false },
  ];
  const existing = renderToStaticMarkup(
    <MatchLobbyReadiness members={members} participantIds={["a", "b"]} />,
  );
  expect(existing).toContain("1 / 2 ready");
  expect(existing).not.toContain("Joined lobby");
  const joined = renderToStaticMarkup(
    <MatchLobbyReadiness members={members} participantIds={["a"]} />,
  );
  expect(joined).toContain("Joined lobby");
  expect(joined).toContain("Bob");
  expect(joined).not.toContain("Alice");
});
