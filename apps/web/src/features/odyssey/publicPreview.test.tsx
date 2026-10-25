import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { publicOdysseyPreview } from "./publicPreview";
import { OdysseyPanel } from "./OdysseyPanel";

it("renders the first public Odyssey level without implying saved progress or exposing later levels", () => {
  const first = {
    title: "Deposits",
    statementMarkdown: "Add money to your balance.",
    methods: [
      {
        className: "Solution" as const,
        methodName: "deposit",
        parameters: [{ name: "amount", type: "int" as const }],
        returnType: "int" as const,
      },
    ],
    examples: [{ args: [], calls: [{ methodName: "deposit", args: [5], expected: 5 }] }],
  };
  const progress = publicOdysseyPreview({
    odyssey: { levels: [first, { ...first, title: "Future level" }] },
  })!;
  expect(progress.levels).toEqual([first]);
  expect(progress.completed).toBe(false);
  const html = renderToStaticMarkup(<OdysseyPanel title="Ledger" progress={progress} />);
  expect(html).toContain("Deposits");
  expect(html).toContain("Add money to your balance.");
  expect(html).toContain("Solution.deposit(amount: int)");
  expect(html).not.toContain("Future level");
  expect(html).not.toContain("Sign in to start");
  expect(publicOdysseyPreview({})).toBeUndefined();
});
