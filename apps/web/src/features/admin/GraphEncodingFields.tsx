/** @file GraphEncodingFields.tsx @description Optional per-value graph encoding controls. @module admin */
import {
  GRAPH_RETURN,
  graphReturnSlot,
  isGraphReturn,
  type GraphEncoding,
} from "@quorem/questions";
import type { Signature } from "@quorem/contracts";
import { SelectField } from "../../ui/SelectField";
import { TextInput } from "../../ui/TextControl";
import { Field } from "./AuthoringFields";

const options = [
  { value: "none", label: "No graph" },
  { value: "edgeList", label: "Edge list" },
  { value: "adjacencyList", label: "Adjacency list" },
  { value: "adjacencyMatrix", label: "Adjacency matrix" },
  { value: "successor", label: "Successor array" },
  { value: "parent", label: "Parent array" },
  { value: "custom", label: "Custom" },
];

export function GraphEncodingFields({
  signature,
  disabled,
  onChange,
}: {
  signature: Signature;
  disabled: boolean;
  onChange: (signature: Signature) => void;
}) {
  const encodings = signature.graphEncodings ?? {};
  const returnType = signature.returnType.replaceAll("array<", "list<");
  const slots = Object.keys(encodings).filter((key) => graphReturnSlot(key) !== undefined);
  const canAddSlot =
    returnType.startsWith("list<") &&
    signature.outputOrder !== "unordered" &&
    !Object.hasOwn(encodings, GRAPH_RETURN);
  const targets = [
    ...signature.parameters,
    ...(slots.length
      ? slots.map((name) => ({ name, type: returnType.slice(5, -1) }))
      : [{ name: GRAPH_RETURN, type: signature.returnType }]),
  ];
  function change(name: string, encoding?: GraphEncoding) {
    const next = { ...encodings };
    if (encoding) next[name] = encoding;
    else delete next[name];
    onChange({ ...signature, graphEncodings: Object.keys(next).length ? next : undefined });
  }
  return (
    <details className="admin-field">
      <summary>Graph encodings</summary>
      {targets.map(({ name, type }) => {
        const output = isGraphReturn(name);
        const slot = graphReturnSlot(name);
        const title =
          slot !== undefined ? `Return value [${slot}]` : output ? "Return value" : name;
        const encoding = Object.hasOwn(encodings, name) ? encodings[name] : undefined;
        const collection = type.replaceAll("array<", "list<");
        const choices = options.filter(
          ({ value }) =>
            value === "none" ||
            value === "custom" ||
            value === encoding?.kind ||
            ((!output || signature.nodeReferences !== "return") &&
              (value === "successor" || value === "parent"
                ? collection === "list<int>"
                : collection === "list<list<int>>")),
        );
        return (
          <div key={name} className="admin-field">
            <Field label={`Graph encoding for ${title}`}>
              <SelectField
                label={`Graph encoding for ${title}`}
                value={encoding?.kind ?? "none"}
                options={choices}
                disabled={disabled}
                onChange={(kind) =>
                  change(
                    name,
                    kind === "none" ? undefined : { kind: kind as GraphEncoding["kind"] },
                  )
                }
              />
            </Field>
            {encoding && encoding.kind !== "custom" && (
              <>
                {!output && (
                  <Field label="Node count argument">
                    <SelectField
                      label={`Node count for ${title}`}
                      value={encoding.countParameter ?? "$none"}
                      disabled={disabled}
                      options={[
                        { value: "$none", label: "None" },
                        ...signature.parameters
                          .filter((p) => p.type === "int" && !encodings[p.name] && p.name !== name)
                          .map((p) => ({ value: p.name, label: p.name })),
                      ]}
                      onChange={(value) =>
                        change(name, {
                          ...encoding,
                          countParameter: value === "$none" ? undefined : value,
                        })
                      }
                    />
                  </Field>
                )}
                {(encoding.kind !== "edgeList" || encoding.countParameter) && (
                  <Field label="First node">
                    <SelectField
                      label={`First node for ${title}`}
                      value={String(encoding.firstNode ?? 0)}
                      disabled={disabled}
                      options={[
                        { value: "0", label: "0" },
                        { value: "1", label: "1" },
                      ]}
                      onChange={(value) =>
                        change(name, { ...encoding, firstNode: value === "1" ? 1 : 0 })
                      }
                    />
                  </Field>
                )}
                {encoding.kind === "edgeList" && (
                  <Field label="Third column" hint="Leave empty for edge pairs">
                    <TextInput
                      aria-label={`Third column for ${title}`}
                      value={encoding.edgeValue ?? ""}
                      disabled={disabled}
                      maxLength={80}
                      placeholder="e.g. Travel time"
                      onChange={(event) =>
                        change(name, { ...encoding, edgeValue: event.target.value || undefined })
                      }
                    />
                  </Field>
                )}
                {encoding.kind === "adjacencyMatrix" && (
                  <Field label="Diagonal default">
                    <SelectField
                      label={`Diagonal for ${title}`}
                      value={String(encoding.matrixDiagonal ?? 0)}
                      disabled={disabled}
                      options={[
                        { value: "0", label: "0" },
                        { value: "1", label: "1" },
                      ]}
                      onChange={(value) =>
                        change(name, { ...encoding, matrixDiagonal: value === "1" ? 1 : 0 })
                      }
                    />
                  </Field>
                )}
              </>
            )}
          </div>
        );
      })}
      {canAddSlot && (
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={() => {
            let index = 0;
            while (Object.hasOwn(encodings, `${GRAPH_RETURN}[${index}]`)) index++;
            const inner = returnType.slice(5, -1);
            change(`${GRAPH_RETURN}[${index}]`, {
              kind:
                inner === "list<list<int>>"
                  ? "edgeList"
                  : inner === "list<int>"
                    ? "successor"
                    : "custom",
            });
          }}
        >
          Add return graph slot
        </button>
      )}
    </details>
  );
}
