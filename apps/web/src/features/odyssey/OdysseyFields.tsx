/** @file OdysseyFields.tsx @description Ordered level and stateful test authoring. @module odyssey */
import type { OdysseyLevel, QuestionContent } from "@quorem/contracts";
import { JSONField, Field } from "../admin/AuthoringFields";
import { SignatureFields } from "../admin/SignatureFields";

/** Edits explicit API contracts; future levels never insert or overwrite candidate source. */
export function OdysseyFields({
  content,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const levels = content.problem.odyssey?.levels;
  function update(next: OdysseyLevel[], hidden = content.odysseyHiddenCases ?? next.map(() => [])) {
    onChange({
      ...content,
      problem: { ...content.problem, odyssey: { levels: next } },
      odysseyHiddenCases: hidden,
    });
  }
  function patch(index: number, value: Partial<OdysseyLevel>) {
    update(levels!.map((level, position) => (position === index ? { ...level, ...value } : level)));
  }
  return (
    <section>
      <h2>Odyssey</h2>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={!!levels}
          onChange={(event) =>
            event.target.checked
              ? update(
                  [
                    {
                      title: "Level 1",
                      statementMarkdown: "",
                      methods: [content.problem.signature],
                      examples: [],
                    },
                  ],
                  [[]],
                )
              : onChange({
                  ...content,
                  problem: { ...content.problem, odyssey: undefined },
                  odysseyHiddenCases: undefined,
                })
          }
        />
        Multi-level question
      </label>
      {levels && (
        <>
          <p>
            Each level adds methods. Candidates write new stubs themselves. Submit runs every
            unlocked suite. Calls within one test share an object; each test starts fresh.
          </p>
          {levels.map((level, index) => (
            <details key={index} className="admin-language" open>
              <summary>
                Level {index + 1}: {level.title}
              </summary>
              <Field label="Level title">
                <input
                  value={level.title}
                  onChange={(event) => patch(index, { title: event.target.value })}
                />
              </Field>
              <Field label="Level statement">
                <textarea
                  rows={4}
                  value={level.statementMarkdown}
                  onChange={(event) => patch(index, { statementMarkdown: event.target.value })}
                />
              </Field>
              {level.methods.map((method, methodIndex) => (
                <section key={methodIndex}>
                  <SignatureFields
                    value={method}
                    allowVoid
                    onValidityChange={onValidityChange}
                    onChange={(next) =>
                      patch(index, {
                        methods: level.methods.map((item, position) =>
                          position === methodIndex ? next : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() =>
                      patch(index, {
                        methods: level.methods.filter((_, position) => position !== methodIndex),
                      })
                    }
                  >
                    Remove method
                  </button>
                </section>
              ))}
              <button
                type="button"
                className="quiet-button"
                disabled={level.methods.length >= 16}
                onClick={() =>
                  patch(index, {
                    methods: [
                      ...level.methods,
                      { className: "Solution", methodName: "", parameters: [], returnType: "int" },
                    ],
                  })
                }
              >
                Add method
              </button>
              <JSONField
                label={`Level ${index + 1} public examples`}
                value={level.examples}
                onChange={(value) => patch(index, { examples: value as OdysseyLevel["examples"] })}
                onValidityChange={onValidityChange}
              />
              <JSONField
                label={`Level ${index + 1} private tests`}
                value={content.odysseyHiddenCases?.[index] ?? []}
                onChange={(value) =>
                  update(
                    levels,
                    levels.map((_, position) =>
                      position === index
                        ? (value as QuestionContent["hiddenCases"])
                        : (content.odysseyHiddenCases?.[position] ?? []),
                    ),
                  )
                }
                onValidityChange={onValidityChange}
              />
              {index === levels.length - 1 && index > 0 && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() =>
                    update(levels.slice(0, -1), content.odysseyHiddenCases?.slice(0, -1))
                  }
                >
                  Remove level
                </button>
              )}
            </details>
          ))}
          <button
            type="button"
            className="quiet-button"
            disabled={levels.length >= 8}
            onClick={() =>
              update(
                [
                  ...levels,
                  {
                    title: `Level ${levels.length + 1}`,
                    statementMarkdown: "",
                    methods: [],
                    examples: [],
                  },
                ],
                [...(content.odysseyHiddenCases ?? levels.map(() => [])), []],
              )
            }
          >
            Add level
          </button>
        </>
      )}
    </section>
  );
}
