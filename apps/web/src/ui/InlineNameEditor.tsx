import { useChangeMotion } from "./useChangeMotion";
import { Fragment, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { TextInput } from "./TextControl";
import { validateInput, type InputConstraint } from "./input-constraints";
import "./inline-name-editor.css";

/** Inline name editing keeps confirmation, validation and keyboard handling together. */
export function InlineNameEditor({
  value,
  label,
  heading: Heading = "span",
  editable,
  disabled,
  constraint,
  onSave,
  validate,
}: {
  value: string;
  label: string;
  heading?: "h2" | "h3" | "span";
  editable: boolean;
  disabled?: boolean;
  constraint: InputConstraint;
  onSave: (name: string) => Promise<boolean | undefined>;
  validate?: (name: string) => string | undefined;
}) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const motionRef = useChangeMotion<HTMLFormElement>(draft === undefined ? value : "editing");
  const cancel = () => {
    setDraft(undefined);
    setError(undefined);
  };
  return (
    <form
      ref={motionRef}
      className="inline-name-editor action-reveal-group"
      onSubmit={async (event) => {
        event.preventDefault();
        if (draft === undefined || disabled) return;
        const parsed = validateInput(draft, constraint);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          return;
        }
        const next = parsed.data;
        const issue = validate?.(next);
        if (issue) {
          setError(issue);
          return;
        }
        if (next === value || (await onSave(next))) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      {draft === undefined || !editable ? (
        <Fragment key="view">
          <Heading>{value}</Heading>
          {editable && (
            <Tooltip content="Rename">
              <button
                type="button"
                className="icon-button"
                data-reveal
                aria-label={`Rename ${value}`}
                disabled={disabled}
                onClick={() => setDraft(value)}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </Fragment>
      ) : (
        <Fragment key="edit">
          <TextInput
            autoFocus
            className="inline-name-input"
            aria-label={label}
            value={draft}
            constraint={constraint}
            disabled={disabled}
            aria-invalid={!!error}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
          />
          <Tooltip content="Save name">
            <button
              type="submit"
              className="icon-button"
              aria-label="Save name"
              disabled={disabled}
            >
              <Check size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Cancel">
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel rename"
              disabled={disabled}
              onClick={cancel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </Fragment>
      )}
      {error && (
        <span className="inline-name-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
