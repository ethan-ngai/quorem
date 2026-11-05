import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { AuthoringCases } from "./AuthoringCases";
import { Field } from "./AuthoringFields";

export function SqlStages({
  content,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const id = useId();
  const levels = content.problem.odyssey!.levels;
  const [keys, setKeys] = useState(() => levels.map((_, index) => index));
  const [selected, setSelected] = useState(0);
  function update(next: typeof levels, hidden = content.odysseyHiddenCases) {
    onChange({
      ...content,
      problem: { ...content.problem, odyssey: { levels: next } },
      odysseyHiddenCases: hidden,
    });
  }
  return (
    <>
      <div className="stage-authoring-nav">
        <AuthoringTabs
          id={id}
          label="SQL steps"
          appearance="underline"
          value={String(selected)}
          onChange={(value) => setSelected(Number(value))}
          tabs={levels.map((_, index) => ({ value: String(index), label: `Step ${index + 1}` }))}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={levels.length >= 8}
          onClick={() => {
            setKeys([...keys, Math.max(...keys, -1) + 1]);
            setSelected(levels.length);
            update(
              [
                ...levels,
                {
                  title: `Step ${levels.length + 1}`,
                  statementMarkdown: "",
                  methods: [],
                  examples: [],
                },
              ],
              [...levels.map((_, index) => content.odysseyHiddenCases?.[index] ?? []), []],
            );
          }}
        >
          Add step
        </button>
      </div>
      {levels.map((level, index) => (
        <div
          key={keys[index]}
          role="tabpanel"
          id={`${id}-${index}-panel`}
          aria-labelledby={`${id}-${index}`}
          hidden={selected !== index}
        >
          <Field label="Step title">
            <input
              value={level.title}
              onChange={(event) =>
                update(
                  levels.map((item, position) =>
                    position === index ? { ...item, title: event.target.value } : item,
                  ),
                )
              }
            />
          </Field>
          <Field label="Step statement">
            <textarea
              rows={3}
              value={level.statementMarkdown}
              onChange={(event) =>
                update(
                  levels.map((item, position) =>
                    position === index ? { ...item, statementMarkdown: event.target.value } : item,
                  ),
                )
              }
            />
          </Field>
          <AuthoringCases
            content={content}
            onChange={onChange}
            onValidityChange={onValidityChange}
            stageIndex={index}
          />
          {levels.length > 1 && (
            <details className="disclosure authoring-options">
              <summary>Step options</summary>
              <button
                type="button"
                className="quiet-button admin-delete-action"
                onClick={() => {
                  setKeys(keys.filter((_, position) => position !== index));
                  setSelected(Math.min(index, levels.length - 2));
                  update(
                    levels.filter((_, position) => position !== index),
                    levels
                      .map((_, position) => content.odysseyHiddenCases?.[position] ?? [])
                      .filter((_, position) => position !== index),
                  );
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> Remove step and its tests
              </button>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
