import { useMemo, useState } from "react";
import { gridRows, ValueGrid } from "./ValueGrid";

const pageSize = 32;

export function CaseGrid({ name, value }: { name: string; value: unknown }) {
  const rows = useMemo(() => gridRows(value), [value]);
  const [page, setPage] = useState(0);
  if (!rows) return null;
  const width = rows[0]!.length;
  const columns = Math.ceil(width / pageSize);
  const pages = Math.ceil(rows.length / pageSize) * columns;
  const index = Math.min(page, pages - 1);
  const row = Math.floor(index / columns) * pageSize;
  const column = (index % columns) * pageSize;
  return (
    <div className="case-grid-preview">
      {pages > 1 && (
        <div className="case-grid-pagination">
          <button
            type="button"
            className="quiet-button"
            aria-label={`Previous ${name} grid page`}
            disabled={index === 0}
            onClick={() => setPage(index - 1)}
          >
            Previous
          </button>
          <span aria-live="polite">
            Rows {row + 1}–{Math.min(row + pageSize, rows.length)} · Columns {column + 1}–
            {Math.min(column + pageSize, width)}
          </span>
          <button
            type="button"
            className="quiet-button"
            aria-label={`Next ${name} grid page`}
            disabled={index === pages - 1}
            onClick={() => setPage(index + 1)}
          >
            Next
          </button>
        </div>
      )}
      <ValueGrid
        label={`Matrix for ${name}`}
        rows={
          pages === 1
            ? rows
            : rows.slice(row, row + pageSize).map((cells) => cells.slice(column, column + pageSize))
        }
      />
    </div>
  );
}
