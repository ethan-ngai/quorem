import { nodeKinds, nodePayloadTypes } from "@quorem/contracts/node-type";
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
  payloadOnly = false,
  onChange,
}: {
  label: string;
  type?: AuthoringType;
  allowVoid?: boolean;
  disabled: boolean;
  depth?: number;
  payloadOnly?: boolean;
  onChange: (type: AuthoringType) => void;
}) {
  const nodeKind = nodeKinds.find((kind) => kind === type?.kind);
  const element =
    type && "element" in type ? type.element : nodeKind ? { kind: "int" as const } : undefined;
  return (
    <div className="authoring-type-block">
      <SearchableTypeSelect<Choice>
        label={label}
        value={type?.kind}
        choices={
          payloadOnly
            ? nodePayloadTypes
            : [
                ...(depth < 100 ? valueAtoms : nodePayloadTypes),
                ...(depth < 100 ? valueWrappers : []),
                ...(allowVoid ? ["void" as const] : []),
              ]
        }
        names={names}
        disabled={disabled}
        onChange={(kind) => {
          if (kind === "ListNode" || kind === "TreeNode") {
            if (type?.kind === kind) return;
            const payload =
              nodePayloadTypes.find((atom) => atom === (element ?? type)?.kind) ?? "int";
            onChange({ kind, element: { kind: payload } });
          } else if (kind === "list" || kind === "optional" || kind === "array") {
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
      {type && element && (
        <>
          <span className="code-operator" aria-hidden="true">
            &lt;
          </span>
          <TypeBlock
            label={`${label} · ${type.kind === "optional" ? "wrapped" : "element"} type`}
            type={element}
            payloadOnly={!!nodeKind}
            disabled={disabled}
            depth={depth + 1}
            onChange={(element) => {
              if (nodeKind) {
                const payload = nodePayloadTypes.find((atom) => atom === element.kind);
                if (payload) onChange({ kind: nodeKind, element: { kind: payload } });
              } else if (
                (type.kind === "list" || type.kind === "array" || type.kind === "optional") &&
                element.kind !== "void"
              ) {
                onChange({ kind: type.kind, element });
              }
            }}
          />
          <span className="code-operator" aria-hidden="true">
            &gt;
          </span>
        </>
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
