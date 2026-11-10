import "./value-grid.css";

export type GridCell = string | number | boolean | null;

/** Bound cell count before mounting a table in the editor. */
export function gridRows(value: unknown, limit = Infinity): GridCell[][] | undefined {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return;
  const width = value[0].length;
  if (!width || value.length * width > limit) return;
  if (
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === width &&
        row.every(
          (cell) =>
            cell === null ||
            typeof cell === "string" ||
            typeof cell === "boolean" ||
            (typeof cell === "number" && Number.isFinite(cell)),
        ),
    )
  )
    return value;
}

export function ValueGrid({
  rows,
  label,
  highlighted,
}: {
  rows: readonly (readonly GridCell[])[];
  label: string;
  highlighted?: ReadonlySet<number>;
}) {
  const width = rows[0]!.length;
  return (
    <div className="value-grid">
      <table aria-label={label}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, column) => {
                const active = highlighted?.has(rowIndex * width + column);
                return (
                  <td
                    key={column}
                    data-highlighted={active || undefined}
                    aria-label={active ? `${cell ?? "Empty"}, highlighted` : undefined}
                  >
                    {cell === null ? null : String(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
