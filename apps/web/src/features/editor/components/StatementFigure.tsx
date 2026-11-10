/** @file StatementFigure.tsx @description Manually authored problem description figures. @module editor */
import "./statement-figure.css";

const maxFigureLength = 32_768;

type Cell = string | number | null;

function isCell(value: unknown): value is Cell {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 80)
  );
}

function readGrid(source: string) {
  try {
    const grid: unknown = JSON.parse(source);
    if (!grid || typeof grid !== "object" || !("cells" in grid)) return;
    const { cells } = grid;
    if (!Array.isArray(cells) || !cells.length || cells.length > 32) return;
    const width = Array.isArray(cells[0]) ? cells[0].length : 0;
    if (!width || width > 32 || cells.length * width > 256) return;
    if (!cells.every((row) => Array.isArray(row) && row.length === width && row.every(isCell)))
      return;
    const highlights = "highlights" in grid ? grid.highlights : [];
    if (!Array.isArray(highlights) || highlights.length > cells.length * width) return;
    const highlighted = new Set<number>();
    for (const cell of highlights) {
      if (!Array.isArray(cell) || cell.length !== 2) return;
      const [row, column] = cell;
      if (
        typeof row !== "number" ||
        typeof column !== "number" ||
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        row >= cells.length ||
        column < 0 ||
        column >= width
      )
        return;
      highlighted.add(row * width + column);
    }
    return { cells, width, highlighted };
  } catch {
    return;
  }
}

/** Keep authored SVG in the browser's image context, isolated from the document. */
function svgImage(source: string, label: string) {
  if (!/^<svg[\s>][\s\S]*<\/svg>$/u.test(source)) return;
  try {
    return (
      <img
        className="statement-figure-svg"
        src={`data:image/svg+xml,${encodeURIComponent(source)}`}
        alt={label}
      />
    );
  } catch {
    return;
  }
}

export function renderStatementFigure(kind: string, source: string, label?: string | null) {
  if (source.length > maxFigureLength) return;
  if (kind === "svg") return svgImage(source.trim(), label?.trim() || "Diagram");
  if (kind !== "grid") return;
  const grid = readGrid(source);
  if (!grid) return;
  const name = label?.trim() || "Grid";
  return (
    <figure className="statement-figure-grid">
      <table aria-label={name}>
        <tbody>
          {grid.cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell: Cell, column: number) => {
                const highlighted = grid.highlighted.has(rowIndex * grid.width + column);
                return (
                  <td
                    key={column}
                    data-highlighted={highlighted || undefined}
                    aria-label={highlighted ? `${cell ?? "Empty"}, highlighted` : undefined}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
