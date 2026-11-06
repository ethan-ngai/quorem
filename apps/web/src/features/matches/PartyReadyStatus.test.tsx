import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PartyReadyStatus } from "./PartyReadyStatus";

it("counts only online ready members and identifies who is waiting", () => {
  const html = renderToStaticMarkup(
    <PartyReadyStatus
      members={[
        { displayName: "Alice", ready: true, online: true },
        { displayName: "Bob", ready: true, online: false },
      ]}
      countdownEndsAt={null}
    />,
  );
  expect(html).toContain("1 / 2 ready");
  expect(html).toContain("Waiting for Bob");
});

it("keeps a shared notice for a failed automatic start", () => {
  const html = renderToStaticMarkup(
    <PartyReadyStatus members={[]} countdownEndsAt={null} queueError="Choose another problem." />,
  );
  expect(html).toContain('aria-label="Next match unavailable"');
  expect(html).toContain("Choose another problem.");
});
