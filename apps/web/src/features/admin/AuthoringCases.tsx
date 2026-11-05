import { caseFieldConfig } from "../editor/inputPresets";
import { randomUUID } from "../../randomUUID";
import { Icon } from "../../ui/Icon";
import "../../ui/result-tabs.css";
import { useEffect, useId, useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { TestCases } from "../editor/components/TestCases";
import {
  createCustomDraft,
  formatTypedField,
  parseCustomDraft,
  parseProblemDraft,
  type CustomCaseDraft,
} from "../editor/customCases";
import "../editor/components/customCases.css";
export function AuthoringCases({
  content,
  onChange,
  onValidityChange,
  stageIndex,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
  stageIndex?: number;
}) {
  const [collection, setCollection] = useState<"public" | "hidden">("public");
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const id = useId();
  const p = content.problem;
  const stage = stageIndex === undefined ? undefined : p.odyssey?.levels[stageIndex];
  const examples = stage?.examples ?? p.examples;
  const hiddenCases =
    stageIndex === undefined
      ? content.hiddenCases
      : (content.odysseyHiddenCases?.[stageIndex] ?? []);
  const caseKey = `cases:${id}`;
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(
    () => () => {
      validity.current(`${caseKey}:public`, false);
      validity.current(`${caseKey}:hidden`, false);
    },
    [caseKey],
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
    id: randomUUID(),
    args: p.sql
      ? [JSON.stringify(test.args[0] ?? { tables: [] })]
      : p.signature.parameters.map((parameter, index) =>
          format(
            parameter.type,
            test.args[index]!,
            defaults.args[index]!,
            caseFieldConfig(p.signature, parameter.type, parameter.input),
          ),
        ),
    expectedEnabled: true,
    expected: p.sql
      ? JSON.stringify(test.expected ?? { rows: [] })
      : format(
          p.signature.returnType,
          test.expected ?? null,
          defaults.expected,
          caseFieldConfig(p.signature, p.signature.returnType, undefined, true),
        ),
  });
  const [values, setValues] = useState(() => ({
    public: examples.map(draft),
    hidden: hiddenCases.map(draft),
  }));
  useEffect(() => {
    for (const tab of ["public", "hidden"] as const) {
      try {
        values[tab].forEach((test) =>
          p.sql ? parseProblemDraft(test, p) : parseCustomDraft(test, p.signature, p.constraints),
        );
        validity.current(`${caseKey}:${tab}`, false);
      } catch {
        validity.current(`${caseKey}:${tab}`, true);
      }
    }
  }, [values, p.sql, p.signature, p.constraints, caseKey]);
  const [explanations, setExplanations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      values.public.map((test, index) => [test.id, examples[index]?.explanation ?? ""]),
    ),
  );
  function change(next: CustomCaseDraft[], descriptions = explanations) {
    setValues((current) => ({ ...current, [collection]: next }));
    try {
      const tests = next.map((test) =>
        p.sql ? parseProblemDraft(test, p) : parseCustomDraft(test, p.signature),
      );
      if (collection === "public") {
        const examples = tests.map((test, index) => ({
          ...test,
          expected: test.expected!,
          explanation: descriptions[next[index]!.id],
        }));
        onChange({
          ...content,
          problem:
            stageIndex === undefined || !p.odyssey
              ? { ...p, examples }
              : {
                  ...p,
                  odyssey: {
                    ...p.odyssey,
                    levels: p.odyssey.levels.map((level, index) =>
                      index === stageIndex ? { ...level, examples } : level,
                    ),
                  },
                },
        });
      } else {
        if (stageIndex === undefined) onChange({ ...content, hiddenCases: tests });
        else
          onChange({
            ...content,
            odysseyHiddenCases: p.odyssey?.levels.map((_, index) =>
              index === stageIndex ? tests : (content.odysseyHiddenCases?.[index] ?? []),
            ),
          });
      }
      if (!p.sql) next.forEach((test) => parseCustomDraft(test, p.signature, p.constraints));
      onValidityChange(`${caseKey}:${collection}`, false);
    } catch {
      onValidityChange(`${caseKey}:${collection}`, true);
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
          problem={p.sql ? { ...p, examples: [] } : p}
          customMode
          drafts={values[collection]}
          onDraftsChange={change}
          requiredExpected
          minimumCases={0}
          maximumCases={collection === "hidden" ? 100 : 20}
          customCaseDetails={
            collection === "public"
              ? (index) => {
                  const example = values.public[index];
                  if (!example) return null;
                  return (
                    <label className="typed-case-field admin-example-explanation">
                      <span>
                        <Icon name="samples" /> Example explanation <small>Optional</small>
                      </span>
                      <textarea
                        rows={2}
                        placeholder="Explain why this example produces the expected output."
                        value={explanations[example.id] ?? ""}
                        onChange={(event) => {
                          const next = { ...explanations, [example.id]: event.target.value };
                          setExplanations(next);
                          change(values.public, next);
                        }}
                      />
                    </label>
                  );
                }
              : undefined
          }
          selectedCustomId={selected[collection]}
          onSelectCustomCase={(value) =>
            setSelected((current) => ({ ...current, [collection]: value }))
          }
        />
      </div>
    </div>
  );
}
