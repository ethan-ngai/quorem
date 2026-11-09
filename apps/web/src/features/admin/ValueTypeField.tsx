import { NoticeRegion } from "../../ui/PersistentNotice";
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

const graphChoice = "Graph";
type Choice = ValueType["kind"] | "void" | typeof graphChoice;
type GraphChoice = { selected: boolean; onSelect: () => void };
type AuthoringType = ValueType | { kind: "void" };
const searchAliases: Record<Exclude<Choice, typeof graphChoice>, string> = {
  int: "Integer",
  long: "64-bit integer",
  float: "Floating-point number",
  str: "Text",
  bool: "Boolean",
  datetime: "Date and time",
  ListNode: "Linked list node",
  TreeNode: "Binary tree node",
  NaryTreeNode: "N-ary tree node",
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
  graph,
  onChange,
}: {
  label: string;
  type?: AuthoringType;
  allowVoid?: boolean;
  disabled: boolean;
  depth?: number;
  payloadOnly?: boolean;
  graph?: GraphChoice;
  onChange: (type: AuthoringType) => void;
}) {
  const nodeKind = nodeKinds.find((kind) => kind === type?.kind);
  const element =
    type && "element" in type ? type.element : nodeKind ? { kind: "int" as const } : undefined;
  return (
    <>
      <span className="authoring-type-token">
        <SearchableTypeSelect<Choice>
          label={label}
          value={graph?.selected ? graphChoice : type?.kind}
          choices={
            payloadOnly
              ? nodePayloadTypes
              : [
                  ...(depth < 100 ? valueAtoms : nodePayloadTypes),
                  ...(depth < 100 ? valueWrappers : []),
                  ...(allowVoid ? ["void" as const] : []),
                  ...(graph ? ([graphChoice] as const) : []),
                ]
          }
          searchAliases={searchAliases}
          disabled={disabled}
          onChange={(kind) => {
            if (kind === graphChoice) {
              graph?.onSelect();
            } else if (kind === "ListNode" || kind === "TreeNode" || kind === "NaryTreeNode") {
              if (type?.kind === kind && !graph?.selected) return;
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
        {!graph?.selected && (element || depth > 0) && (
          <span className="code-operator" aria-hidden="true">
            {element ? "<" : ">".repeat(depth)}
          </span>
        )}
      </span>
      {!graph?.selected && type && element && (
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
      )}
    </>
  );
}

export function ValueTypeField({
  label,
  hideLabel = false,
  value,
  allowVoid = false,
  disabled,
  graph,
  onChange,
  onValidityChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  allowVoid?: boolean;
  disabled: boolean;
  graph?: GraphChoice;
  onChange: (value: string) => void;
  onValidityChange?: (id: string, invalid: boolean) => void;
}) {
  const id = useId();
  const type = allowVoid && value === "void" ? { kind: "void" as const } : parseValueType(value);
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  const invalid = !type && !graph?.selected;
  useEffect(() => {
    validity.current?.(id, invalid);
  }, [id, invalid]);
  useEffect(() => () => validity.current?.(id, false), [id]);
  const control = (
    <div className="authoring-type-block">
      <TypeBlock
        label={label}
        type={type}
        allowVoid={allowVoid}
        disabled={disabled}
        graph={graph}
        onChange={(next) => onChange(next.kind === "void" ? "void" : formatValueType(next))}
      />
    </div>
  );
  return (
    <div className="admin-field">
      {!hideLabel && <span>{label}</span>}
      {graph?.selected ? (
        control
      ) : (
        <NoticeRegion
          message={invalid ? `Replace unsupported type ${value}.` : undefined}
          label="Check type"
        >
          {control}
        </NoticeRegion>
      )}
    </div>
  );
}
