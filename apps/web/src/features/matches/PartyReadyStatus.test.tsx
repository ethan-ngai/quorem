import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  PartyReadyStatus,
  PartyMemberReadiness,
  PartyReadinessIndicator,
} from "./PartyReadyStatus";

it("shows each member's readiness and distinguishes an offline ready member", () => {
  const html = renderToStaticMarkup(
    <PartyMemberReadiness
      members={[
        { displayName: "Alice", ready: true, online: true },
        { displayName: "Bob", ready: true, online: false },
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
});
