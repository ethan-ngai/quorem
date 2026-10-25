import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuestionHintsControls } from "./QuestionHintsControls";

it("does not offer complexity when unavailable, even if an older policy allowed it", () => {
  const html = renderToStaticMarkup(
    <QuestionHintsControls value={{ complexity: true }} onChange={() => {}} />,
  );
  expect(html).toContain("Allow topics");
  expect(html).not.toContain("Allow complexity");
});
it("offers complexity only for known published availability", () => {
  const html = renderToStaticMarkup(
    <QuestionHintsControls complexityAvailable value={{}} onChange={() => {}} />,
  );
  expect(html).toContain("Allow complexity");
});
