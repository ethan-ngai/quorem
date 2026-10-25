import { Icon } from "../editor/components/Icon";
import "../../ui/result-tabs.css";
import { useEffect, useId, useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { TestCases } from "../editor/components/TestCases";
import {
  createCustomDraft,
  formatTypedField,
  parseCustomDraft,
  type CustomCaseDraft,
} from "../editor/customCases";
import "../editor/components/customCases.css";
export function AuthoringCases({
  content,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const [collection, setCollection] = useState<"public" | "hidden">("public");
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const id = useId();
  const p = content.problem;
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(
    () => () => {
      validity.current("cases:public", false);
      validity.current("cases:hidden", false);
    },
    [],
  );
  const defaults = createCustomDraft({ ...p, examples: [] });
  function format(
    type: string,
    value: Parameters<typeof formatTypedField>[1],
    fallback: string,
    input?: Parameters<typeof formatTypedField>[2],
  ) {
    try {
      return formatTypedField(type, value, input);
    } catch {
      return fallback;
    }
  }

  const draft = (test: QuestionContent["hiddenCases"][number]): CustomCaseDraft => ({
    id: crypto.randomUUID(),
    args: p.signature.parameters.map((parameter, index) =>
      format(parameter.type, test.args[index]!, defaults.args[index]!, parameter.input),
    ),
    expectedEnabled: true,
    expected: format(p.signature.returnType, test.expected ?? null, defaults.expected),
  });
  const [values, setValues] = useState(() => ({
    public: p.examples.map(draft),
    hidden: content.hiddenCases.map(draft),
  }));
  const [explanations, setExplanations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      values.public.map((test, index) => [test.id, p.examples[index]?.explanation ?? ""]),
    ),
  );
  function change(next: CustomCaseDraft[], descriptions = explanations) {
    setValues((current) => ({ ...current, [collection]: next }));
    try {
      const tests = next.map((test) => parseCustomDraft(test, p.signature, p.constraints));
      onValidityChange(`cases:${collection}`, false);
      if (collection === "public")
        onChange({
          ...content,
          problem: {
            ...p,
            examples: tests.map((test, index) => ({
              ...test,
              expected: test.expected!,
              explanation: descriptions[next[index]!.id],
            })),
          },
        });
      else
        onChange({
          ...content,
          hiddenCases: tests.map((test) => ({ ...test, expected: test.expected! })),
        });
    } catch {
      onValidityChange(`cases:${collection}`, true);
    }
  }
  return (
    <div className="authoring-test-collections">
      <div className="result-tabs" role="tablist" aria-label="Question tests">
        {(["public", "hidden"] as const).map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab}
            id={`${id}-${tab}`}
            aria-selected={collection === tab}
            aria-controls={`${id}-cases`}
            tabIndex={collection === tab ? 0 : -1}
            onClick={() => setCollection(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "public"
                  : event.key === "End"
                    ? "hidden"
                    : tab === "public"
                      ? "hidden"
                      : "public";
              setCollection(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
          >
            <Icon name={tab === "public" ? "samples" : "lock"} />
            {tab === "public" ? "Examples" : "Private tests"} ({values[tab].length})
          </button>
        ))}
      </div>
      <div
        className="authoring-case-browser"
        role="tabpanel"
        id={`${id}-cases`}
        aria-labelledby={`${id}-${collection}`}
      >
        <TestCases
          key={collection}
          problem={p}
          customMode
          drafts={values[collection]}
          onDraftsChange={change}
          requiredExpected
          minimumCases={0}
          selectedCustomId={selected[collection]}
          onSelectCustomCase={(value) =>
            setSelected((current) => ({ ...current, [collection]: value }))
          }
        />
      </div>
      {collection === "hidden" && values.hidden.length < 20 && (
        <button
          type="button"
          className="quiet-button"
          onClick={() =>
            change([
              ...values.hidden,
              ...Array.from({ length: 20 - values.hidden.length }, () => ({
                ...createCustomDraft(p),
                expectedEnabled: true,
              })),
            ])
          }
        >
          Fill to 20 private tests
        </button>
      )}
      {collection === "public" &&
        values.public.map((example, index) => (
          <label className="admin-field" key={example.id}>
            <span>Example {index + 1} explanation</span>
            <textarea
              rows={2}
              value={explanations[example.id] ?? ""}
              onChange={(event) => {
                const next = { ...explanations, [example.id]: event.target.value };
                setExplanations(next);
                change(values.public, next);
              }}
            />
          </label>
        ))}
    </div>
  );
}
