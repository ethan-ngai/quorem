/** @file GraphNodeValues.tsx @description Optional node payloads keyed by stable node ID. @module admin */
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Table } from "../../ui/Table";
import { TextInput } from "../../ui/TextControl";
import { Tooltip } from "../../ui/Tooltip";
import { nodeValueRow, type NodeValueRow } from "./graphForm";

const pageSize = 32;

export function GraphNodeValues({
  label,
  rows,
  type,
  onChange,
}: {
  label: string;
  rows: NodeValueRow[];
  type: string;
  onChange: (rows: NodeValueRow[]) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const page = Math.min(pageIndex, last);
  const start = page * pageSize;
  return (
    <details className="graph-node-values">
      <summary>
        Node values · {type}
        {rows.length ? ` (${rows.length})` : ""}
      </summary>
      {rows.length > 0 && (
        <Table
          label={`${label} node values`}
          className="graph-edge-table"
          heading={
            <tr>
              <th scope="col">Node ID</th>
              <th scope="col">Value</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          }
        >
          {rows.slice(start, start + pageSize).map((row, offset) => (
            <tr key={row.id}>
              {(["node", "value"] as const).map((field) => (
                <td key={field}>
                  <TextInput
                    mono
                    aria-label={`${field === "node" ? "Node ID" : "Node value"}, row ${start + offset + 1}`}
                    value={row[field]}
                    placeholder={field === "value" ? type : undefined}
                    onChange={(event) =>
                      onChange(
                        rows.map((entry) =>
                          entry.id === row.id ? { ...entry, [field]: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </td>
              ))}
              <td>
                <Tooltip content="Remove node value">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove node value ${start + offset + 1}`}
                    onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <button
        type="button"
        className="quiet-button"
        onClick={() => {
          setPageIndex(Math.floor(rows.length / pageSize));
          onChange([...rows, nodeValueRow()]);
        }}
      >
        <Plus size={14} aria-hidden="true" /> Add node value
      </button>
      {last > 0 && (
        <div className="graph-edge-pages">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous node value page"
            disabled={page === 0}
            onClick={() => setPageIndex(page - 1)}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span>
            {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next node value page"
            disabled={page === last}
            onClick={() => setPageIndex(page + 1)}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </details>
  );
}
