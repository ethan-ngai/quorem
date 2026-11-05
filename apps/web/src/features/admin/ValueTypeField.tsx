import { useEffect, useId, useRef } from "react";
import { SearchableTypeSelect } from "./SearchableTypeSelect";
import {
  formatValueType,
  parseValueType,
  valueAtoms,
  valueWrappers,
  type ValueType,
} from "../editor/typedValues";

type Choice = ValueType["kind"] | "void";
type AuthoringType = ValueType | { kind: "void" };
const names: Record<Choice, string> = {
  int: "Integer",
  long: "64-bit integer",
  float: "Floating-point number",
  str: "Text",
  bool: "Boolean",
  datetime: "Date and time",
  ListNode: "Linked list node",
  TreeNode: "Binary tree node",
  list: "List of",
  array: "Array of",
  optional: "Optional",
  void: "No return value",
};

function TypeBlock({
  label,
  type,
  allowVoid = false,
  disabled,
  depth = 0,
  onChange,
}: {
  label: string;
  type?: AuthoringType;
  allowVoid?: boolean;
  disabled: boolean;
  depth?: number;
  onChange: (type: AuthoringType) => void;
}) {
  return (
    <div className="authoring-type-block" data-generic={!!type && "element" in type}>
      <SearchableTypeSelect<Choice>
        label={label}
        value={type?.kind}
        choices={[
          ...valueAtoms,
          ...(depth < 100 ? valueWrappers : []),
          ...(allowVoid ? ["void" as const] : []),
        ]}
        names={names}
        disabled={disabled}
        onChange={(kind) => {
          if (kind === "list" || kind === "optional" || kind === "array") {
            const element =
              type && type.kind !== "void"
                ? "element" in type
                  ? type.element
                  : type
                : { kind: "int" as const };
            onChange({ kind, element });
          } else {
            onChange({ kind });
          }
        }}
      />
      {type && "element" in type && (
        <TypeBlock
          label={`${label} · ${type.kind === "optional" ? "wrapped" : "element"} type`}
          type={type.element}
          disabled={disabled}
          depth={depth + 1}
          onChange={(element) => {
            if (element.kind !== "void") onChange({ ...type, element });
          }}
        />
      )}
    </div>
  );
}

export function ValueTypeField({
  label,
  value,
  allowVoid = false,
  disabled,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: string;
  allowVoid?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onValidityChange?: (id: string, invalid: boolean) => void;
}) {
  const id = useId();
  const type = allowVoid && value === "void" ? { kind: "void" as const } : parseValueType(value);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  const invalid = !type;
  useEffect(() => {
    validity.current?.(id, invalid);
  }, [id, invalid]);
  useEffect(() => () => validity.current?.(id, false), [id]);
  return (
    <div className="admin-field">
      <span>{label}</span>
      <TypeBlock
        label={label}
        type={type}
        allowVoid={allowVoid}
        disabled={disabled}
        onChange={(next) => onChange(next.kind === "void" ? "void" : formatValueType(next))}
      />
      {invalid && (
        <span className="admin-error">
          Replace unsupported type <code>{value}</code>.
        </span>
      )}
    </div>
  );
}
