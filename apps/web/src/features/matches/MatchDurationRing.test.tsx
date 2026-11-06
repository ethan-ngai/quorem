import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MatchDurationRing } from "./MatchDurationRing";

it("shows actual elapsed time beside a ring proportional to the limit", () => {
  const html = renderToStaticMarkup(
    <MatchDurationRing durationMinutes={30} elapsedSeconds={522} />,
  );
  expect(html).toContain('aria-label="8:42 elapsed of 30:00 allowed"');
  expect(html).toContain('stroke-dasharray="0.29 1"');
  expect(html).not.toContain("of 30 min");
});
it("keeps overrun time accurate while bounding the visual fraction", () => {
  const html = renderToStaticMarkup(
    <MatchDurationRing durationMinutes={30} elapsedSeconds={1900} />,
  );
  expect(html).toContain('aria-label="31:40 elapsed of 30:00 allowed"');
  expect(html).toContain('stroke-dasharray="1 1"');
});
it("shows only the limit when the match has no elapsed duration", () => {
  const html = renderToStaticMarkup(
    <MatchDurationRing durationMinutes={30} />,
  );
  expect(html).toContain('aria-label="30-minute time limit"');
  expect(html).not.toContain("match-duration-ring");
});

it("keeps long elapsed values outside the ring and exact values in the tooltip", () => {
  const html = renderToStaticMarkup(
    <MatchDurationRing durationMinutes={60} elapsedSeconds={3723} />,
  );
  expect(html).toContain('aria-label="1:02:03 elapsed of 1:00:00 allowed"');
  expect(html).toContain('class="match-duration-value" aria-hidden="true">1:02:03');
});

it("keeps all four minute/second digits beside the ring", () => {
  const html = renderToStaticMarkup(
    <MatchDurationRing durationMinutes={60} elapsedSeconds={1842} />,
  );
  expect(html).toContain('class="match-duration-value" aria-hidden="true">30:42');
});
