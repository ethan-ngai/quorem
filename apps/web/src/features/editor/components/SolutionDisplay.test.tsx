import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blankApproach } from "@quorem/questions";
import { SolutionDisplay } from "./SolutionDisplay";

const approach = {
  ...blankApproach("java", "java-approach"),
  implementations: [
    { language: "python" as const, source: "PYTHON_SOURCE" },
    { language: "java" as const, source: "JAVA_SOURCE" },
  ],
};
const render = (props: Partial<Parameters<typeof SolutionDisplay>[0]> = {}) =>
  renderToStaticMarkup(
    <SolutionDisplay
      approaches={[approach]}
      canonicalApproachId={approach.id}
      theme="dark"
      colorScheme="jetbrains-dark"
      {...props}
    />,
  );

it("shows one code language and falls back to the approach default", () => {
  const markup = render({ preferredLanguage: "ocaml" });
  expect(markup).toContain('aria-label="Solution language"');
  expect(markup).toContain("JAVA_SOURCE");
  expect(markup).not.toContain("PYTHON_SOURCE");
});

it("honors the preferred language when an authored variant exists", () => {
  const markup = render({ preferredLanguage: "python" });
  expect(markup).toContain("PYTHON_SOURCE");
  expect(markup).not.toContain("JAVA_SOURCE");
});

it("omits empty variants and unnecessary single-language dropdowns", () => {
  const markup = render({
    approaches: [
      {
        ...approach,
        implementations: [
          { language: "python", source: "PYTHON_SOURCE" },
          { language: "java", source: " " },
        ],
      },
    ],
  });
  expect(markup).not.toContain('role="combobox"');
  expect(markup).toContain("PYTHON_SOURCE");
});

it("keeps code and metadata scoped to the selected approach", () => {
  const alternative = {
    ...blankApproach("python", "alternative"),
    title: "Alternative",
    implementations: [{ language: "python" as const, source: "ALTERNATIVE_SOURCE" }],
  };
  const approaches = [alternative, approach];
  expect(render({ approaches })).toContain("JAVA_SOURCE");
  const selected = render({ approaches, selectedId: alternative.id });
  expect(selected).toContain("ALTERNATIVE_SOURCE");
  expect(selected).not.toContain("JAVA_SOURCE");
});
