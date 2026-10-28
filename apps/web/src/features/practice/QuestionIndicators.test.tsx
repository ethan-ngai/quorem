import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuestionIndicators } from "./QuestionIndicators";

it("independently marks private and Odyssey questions", () => {
  const both = renderToStaticMarkup(<QuestionIndicators privateQuestion odyssey />);
  expect(both).toContain('aria-label="Private question"');
  expect(both).toContain('aria-label="Odyssey"');
  const global = renderToStaticMarkup(<QuestionIndicators privateQuestion={false} odyssey />);
  expect(global).not.toContain('aria-label="Private question"');
  expect(global).toContain('aria-label="Odyssey"');
  const classic = renderToStaticMarkup(<QuestionIndicators privateQuestion odyssey={false} />);
  expect(classic).toContain('aria-label="Private question"');
  expect(classic).not.toContain('aria-label="Odyssey"');
});
