import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ScoreProgress } from "./ScoreProgress";

it("pairs an exact score with its identity-colored fraction", () => {
  const html = renderToStaticMarkup(
    <ScoreProgress score={{ passed: 18, total: 24 }} color="oklch(0.53 0.13 255)" />,
  );
  expect(html).toContain('aria-label="18 of 24 cases passed"');
  expect(html).toContain("--score-progress:75%");
  expect(html).toContain("--score-color:oklch(0.53 0.13 255)");
});
it("keeps absent and empty scores distinct from zero passed", () => {
  expect(renderToStaticMarkup(<ScoreProgress color="blue" />)).toContain('aria-label="No score"');
  const zero = renderToStaticMarkup(
    <ScoreProgress score={{ passed: 0, total: 24 }} color="blue" />,
  );
  expect(zero).toContain("--score-progress:0%");
  expect(zero).toContain('data-unavailable="false"');
  const empty = renderToStaticMarkup(
    <ScoreProgress score={{ passed: 0, total: 0 }} color="blue" />,
  );
  expect(empty).not.toContain("NaN");
  expect(empty).toContain('data-unavailable="true"');
});
