import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BulkQuestionConfirmation } from "./BulkQuestionConfirmation";

vi.mock("../../ui/SessionDialog", () => ({
  SessionDialog: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
}));

const props = {
  action: "publish" as const,
  scope: "drafts" as const,
  admin: true,
  visibility: "private" as const,
  running: false,
  onVisibilityChange: () => {},
  onClose: () => {},
  onConfirm: () => {},
};

it("exposes both publication targets and keeps review collapsed", () => {
  const markup = renderToStaticMarkup(
    <BulkQuestionConfirmation
      {...props}
      questions={[{ id: "a", title: "Question A", revision: "1" }]}
    />,
  );
  expect(markup).toContain('aria-label="Publication visibility"');
  expect(markup).toContain('aria-label="My library" aria-checked="true"');
  expect(markup).toContain('aria-label="Global catalog"');
  expect(markup).not.toContain("<select");
  expect(markup).toContain('<details class="disclosure bulk-question-review">');
});

it("does not offer a visibility change for existing publications", () => {
  const markup = renderToStaticMarkup(
    <BulkQuestionConfirmation
      {...props}
      questions={[{ id: "a", title: "Question A", revision: "1", editVersionId: "version" }]}
    />,
  );
  expect(markup).not.toContain('aria-label="Publication visibility"');
  expect(markup).toContain("Updates keep their existing visibility.");
});

it("makes large selections searchable without changing the confirmed set", () => {
  const questions = Array.from({ length: 721 }, (_, index) => ({
    id: String(index),
    title: `Question ${index}`,
    revision: "1",
  }));
  const markup = renderToStaticMarkup(
    <BulkQuestionConfirmation {...props} questions={questions} />,
  );
  expect(markup).toContain("Publish 721 drafts?");
  expect(markup).toContain('aria-label="Filter selected questions"');
  expect(markup).toContain('class="bulk-review-list"');
});
