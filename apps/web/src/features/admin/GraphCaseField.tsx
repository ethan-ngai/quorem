/** @file GraphCaseField.tsx @description Graph topology editing beside the live case preview. @module admin */
import { useRef, useState, type ClipboardEvent } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { GraphEncoding, QuestionGraph } from "@quorem/questions";
import { TextInput } from "../../ui/TextControl";
import { Table } from "../../ui/Table";
import { Tooltip } from "../../ui/Tooltip";
import { CodeLiteral } from "../editor/components/CodeLiteral";
import GraphDiagram from "../editor/components/GraphDiagram";
import { graphRow, numberedGraph, type GraphForm, type GraphRow } from "./graphForm";
import { GraphNodeValues } from "./GraphNodeValues";
import "./graph-authoring.css";

const pageSize = 32;

export function GraphCaseField({
  label,
  encoding,
  form,
  graph,
  error,
  limit,
  onChange,
  solverPreview,
}: {
  label: string;
  encoding: GraphEncoding;
  form: GraphForm;
  graph?: QuestionGraph;
  error?: string;
  limit: number;
  onChange: (form: GraphForm) => void;
  solverPreview?: { kind: "input" | "output"; source: string };
}) {
  const [active, setActive] = useState<string>();
  const [pageIndex, setPageIndex] = useState(0);
  const lastPage = Math.max(0, Math.ceil(form.edges.length / pageSize) - 1);
  const page = Math.min(pageIndex, lastPage);
  const start = page * pageSize;
  const add = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hasEdgeValues = encoding.kind === "custom" || form.edges.some(({ value }) => value !== "");
  const weight = encoding.edgeValue ?? (hasEdgeValues ? "Value" : undefined);
  const numbered = numberedGraph(encoding);
  const fields = weight ? (["from", "to", "value"] as const) : (["from", "to"] as const);
  const headings = ["From", "To", weight];
  const canAdd = form.edges.length < limit;
  function replaceRows(edges: GraphRow[]) {
    onChange({ ...form, edges });
  }
  function focusRow(row: GraphRow | undefined) {
    if (!row) return add.current?.focus();
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLInputElement>(`[data-graph-row="${row.id}"] input`)?.focus(),
    );
  }
  function paste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const source = event.clipboardData.getData("text/plain").trim();
    if (!/[\n\t]/.test(source) || source.length > 100000) return;
    const rows = source
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) =>
        line
          .trim()
          .split(line.includes("\t") ? "\t" : /,| +/)
          .map((value) => value.trim()),
      );
    if (
      rows.some((row) => row.length < 2 || row.length > fields.length) ||
      index + rows.length > limit
    )
      return;
    event.preventDefault();
    replaceRows([
      ...form.edges.slice(0, index),
      ...rows.map(([from, to, value], offset) => {
        const existing = form.edges[index + offset];
        return existing
          ? { ...existing, from: from!, to: to!, value: value ?? "" }
          : graphRow(from, to, value);
      }),
      ...form.edges.slice(index + rows.length),
    ]);
  }
  return (
    <section className="graph-case-field" aria-label={`${label} graph`}>
      <div className="graph-binding-heading">
        <strong>{label}</strong>
      </div>
      <div className="graph-case-layout">
        <div ref={root} className="graph-case-controls">
          <label className="admin-field graph-case-nodes">
            <span>{numbered ? "Nodes" : "Node IDs"}</span>
            <TextInput
              mono
              aria-label={`${label} ${numbered ? "node count" : "node labels"}`}
              inputMode={numbered ? "numeric" : undefined}
              value={form.nodes}
              placeholder={numbered ? "0" : "A, B, C"}
              onChange={(event) => onChange({ ...form, nodes: event.target.value })}
            />
          </label>
          {encoding.kind === "custom" && encoding.nodeValueType && (
            <GraphNodeValues
              label={label}
              rows={form.nodeValues}
              type={encoding.nodeValueType}
              onChange={(nodeValues) => onChange({ ...form, nodeValues })}
            />
          )}
          <Table
            label={`${label} edges`}
            className="graph-edge-table"
            heading={
              <tr>
                {fields.map((field, i) => (
                  <th key={field} scope="col">
                    {headings[i]}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            }
          >
            {form.edges.slice(start, start + pageSize).map((row, offset) => {
              const index = start + offset;
              return (
                <tr
                  key={row.id}
                  data-graph-row={row.id}
                  onFocusCapture={() => setActive(row.id)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setActive(undefined);
                  }}
                >
                  {fields.map((field, i) => (
                    <td key={field}>
                      <TextInput
                        mono
                        aria-label={`${headings[i]}, edge ${index + 1}`}
                        value={row[field]}
                        placeholder={field === "value" ? encoding.edgeValueType : undefined}
                        onPaste={(event) => paste(event, index)}
                        onChange={(event) =>
                          replaceRows(
                            form.edges.map((edge) =>
                              edge.id === row.id ? { ...edge, [field]: event.target.value } : edge,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <Tooltip content="Remove edge">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove edge ${index + 1}`}
                        onClick={() => {
                          focusRow(form.edges[index + 1] ?? form.edges[index - 1]);
                          replaceRows(form.edges.filter((edge) => edge.id !== row.id));
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
          </Table>
          <button
            ref={add}
            type="button"
            className="quiet-button"
            disabled={!canAdd}
            onClick={() => {
              const row = graphRow();
              setPageIndex(Math.floor(form.edges.length / pageSize));
              replaceRows([...form.edges, row]);
              focusRow(row);
            }}
          >
            <Plus size={14} aria-hidden="true" /> Add edge
          </button>
          {lastPage > 0 && (
            <div className="graph-edge-pages">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous edge page"
                disabled={page === 0}
                onClick={() => setPageIndex(page - 1)}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <span>
                {start + 1}–{Math.min(start + pageSize, form.edges.length)} of {form.edges.length}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Next edge page"
                disabled={page === lastPage}
                onClick={() => setPageIndex(page + 1)}
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          {error && (
            <p className="typed-case-error" role="status">
              {error}
            </p>
          )}
        </div>
        {graph && (
          <GraphDiagram
            graph={graph}
            label={label}
            hideCaption
            activeEdge={error ? undefined : form.edges.findIndex(({ id }) => id === active)}
          />
        )}
      </div>
      {solverPreview && (
        <div className="graph-solver-preview">
          <span>
            {error ? "Last valid solver" : "Solver"} {solverPreview.kind}
          </span>
          <CodeLiteral className="graph-solver-literal" source={solverPreview.source} block />
        </div>
      )}
    </section>
  );
}
