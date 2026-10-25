/** @file AuthoringFields.tsx @description Shared labeled fields and typed JSON authoring. @module admin */
import { useEffect, useRef, useState, type ReactNode } from "react";
/** @returns A labeled field that keeps native focus and keyboard behavior. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Retains invalid JSON text for correction instead of reverting the user's input. */
export function JSONField({
  label,
  value,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: unknown;
  onValidityChange: (label: string, invalid: boolean) => void;
  onChange: (value: unknown) => void;
}) {
  const [source, setSource] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current(label, false), [label]);
  return (
    <Field label={label}>
      <textarea
        className="admin-code"
        rows={6}
        value={source}
        aria-invalid={invalid}
        onChange={(event) => {
          setSource(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            if (!validJSONShape(label, parsed)) throw new Error("Invalid shape");
            setInvalid(false);
            onValidityChange(label, false);
            onChange(parsed);
          } catch {
            setInvalid(true);
            onValidityChange(label, true);
          }
        }}
      />
      {invalid && (
        <span className="admin-error">Invalid JSON or shape. Fix this field before saving.</span>
      )}
    </Field>
  );
}

/** Prevents malformed typed collections from reaching preview rendering. */
export function validJSONShape(label: string, value: unknown): boolean {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  if (label === "Typed signature")
    return (
      record(value) &&
      typeof value.className === "string" &&
      typeof value.methodName === "string" &&
      typeof value.returnType === "string" &&
      Array.isArray(value.parameters) &&
      value.parameters.every(
        (parameter) =>
          record(parameter) &&
          typeof parameter.name === "string" &&
          typeof parameter.type === "string",
      )
    );
  if (label === "Execution limits")
    return (
      record(value) &&
      [
        "wallTimeMs",
        "memoryBytes",
        "outputBytes",
        "maxProcesses",
        "maxCollectionElements",
        "maxNestingDepth",
      ].every(
        (name) =>
          typeof value[name] === "number" &&
          Number.isSafeInteger(value[name]) &&
          Number(value[name]) > 0,
      )
    );
  if (!Array.isArray(value)) return false;
  if (label.startsWith("Level ") && label.endsWith("methods"))
    return value.every((item) => validJSONShape("Typed signature", item));
  if (label.startsWith("Level "))
    return value.every(
      (item) =>
        record(item) &&
        Array.isArray(item.args) &&
        (item.calls === undefined || Array.isArray(item.calls)),
    );
  if (label === "Structured constraints") {
    const target = (item: unknown) =>
      record(item) && typeof item.parameter === "string" && typeof item.projection === "string";
    return value.every(
      (item) =>
        record(item) &&
        (item.kind === "prose"
          ? typeof item.text === "string"
          : item.kind === "range" || item.kind === "property"
            ? target(item.target)
            : item.kind === "comparison"
              ? target(item.left) && target(item.right)
              : false),
    );
  }
  return value.every((item) => record(item) && Array.isArray(item.args) && "expected" in item);
}
